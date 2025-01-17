'use strict'

/**
 * Express HTTP server
 *
 * @module cactus-server
 */

const express = require('express')
const http = require('http')

const { io, exitHook } = require('@quisitive/node-application')
const errors = require('@quisitive/errors')
const logger = require('@quisitive/logger')

const pre = require('./lib/pre')
const security = require('./lib/security')
const utils = require('./lib/utils')

const QuisitiveError = errors.QuisitiveError
const InternalServerError = errors.InternalServerError
const NotImplementedError = errors.NotImplementedError
const NotFoundError = errors.NotFoundError

class CactusServer {
  constructor (config = {}) {
    this.log = logger('server')
    this.port = config.port || 8080
    this.server = http.createServer()
    this.app = express()

    this.app.set('json spaces', 4)
    this.app.set('json escape', true)
    this.app.set('trust proxy', true)
    this.app.set('x-powered-by', false)

    this.app.set('name', config.name || 'generic-server')
    this.app.set('version', config.version || '1.0.0')
    this.app.set('service', config.service || 'is.cactus')
    this.app.set('domain', utils.asHeader(config.domain || 'Cactus'))
    /* prettier-ignore */
    this.app.set('allowHeaders', config.allowHeaders || 'Content-Type, Authorization, X-Cactus-Debug')

    this.app.use(pre.requestStart)
    this.app.use(pre.serverHeaders)
    this.app.use(pre.setRequestIp)
    this.app.use(pre.setRequestId)
    this.app.use(pre.setAuthDefaults)
    this.app.use(pre.compressResponses)

    this.app.use(security.dnsPreFetchControl)
    // this.app.use(security.frameGuard)
    this.app.use(security.ieNoOpen)
    this.app.use(security.noSniff)
    this.app.use(security.xssFilter)
    this.app.use(security.referrerPolicy)

    this.app.use(pre.crossOrigin)
    this.app.use(pre.preFlight)
    this.app.use(pre.serveFavicon)
    this.app.use(pre.serveFiles)
    this.app.use(pre.logRequests)

    this.app.use(pre.jsonParser)

    this.server.on('request', this.app)
    this.server.on('error', onError)
  }

  /**
   * Binds the server to the given Port
   *
   * @param  {Number} port
   *
   * @return {Promise}
   */

  listen () {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => {
        this.log.info(`Listening on port: ${this.port}`)
        exitHook(done => {
          this.log.info('Closing the http server')
          this.server.close(err => {
            if (err) this.log.error(err)
            done()
          })
        })
        resolve()
      })
    })
  }

  /**
   * Logs the error
   *
   * @param {Error}        error
   * @param {HttpRequest}  request
   * @param {HttpResponse} response
   * @param {Function}     next
   */

  static logErrors (error, request, response, next) {
    request.log.trace('Handler: logErrors')

    if (error instanceof QuisitiveError === false) {
      error = new InternalServerError(error, error.message)
    }

    if (error.status >= 500) {
      request.log.error(error, error.message)
    } else {
      error.stack = '\n'
      request.log.warn(error, error.message)
    }

    next(error)
  }

  /**
   * Sends the error to pm2.io and calls next
   *
   * @param {Error}        error
   * @param {HttpRequest}  request
   * @param {HttpResponse} response
   * @param {Function}     next
   */

  static notifyErrors (error, request, response, next) {
    request.log.trace('Handler: notifyErrors')
    if (error.status >= 500) {
      error.url = request.originalUrl
      error.action = request.method
      io.notifyError(error)
    }
    next(error)
  }

  /**
   * Answers the request with an empty response
   *
   * @param     {HttpRequest}       request
   * @param     {HttpResponse}      response
   */

  static emptyResponse (request, response) {
    request.log.trace('Handler: Empty response')
    response.sendStatus(200)
  }

  /**
   * Calls next with a NOT IMPLEMENTED Error
   *
   * @param     {HttpRequest}       request
   * @param     {HttpResponse}      response
   * @param     {Function}          next
   */

  static notImplementedResponse (request, response, next) {
    request.log.trace('Handler: notImplemented')
    next(new NotImplementedError(request.originalUrl))
  }

  /**
   * Calls next with a NOT FOUND Error
   *
   * @param     {HttpRequest}       request
   * @param     {HttpResponse}      response
   * @param     {Function}          next
   */

  static notFoundResponse (request, response, next) {
    request.log.trace('Handler: notFound')
    return next(new NotFoundError(request.originalUrl))
  }
}

module.exports = CactusServer

// ────────────────────────────────  Private  ──────────────────────────────────

function onError (error) {
  switch (error.code) {
    case 'EACCES':
      throw new InternalServerError(error, 'Port require elevated privileges')
    case 'EADDRINUSE':
      throw new InternalServerError(error, 'Port is already in use')
    default:
      throw new InternalServerError(error, error.message)
  }
}
