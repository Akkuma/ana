/**
 * restana Web Framework implementation
 *
 * @license MIT
 */

/**
 * importing supported HTTP methods
 */
const methods = require('./libs/methods')
/**
 * importing request router builder function
 */
const requestRouter = require('./libs/request-router')
/**
 * preparing request/response objects extensions
 */
const exts = {
  request: {},
  response: require('./libs/response-extensions')
}
/**
 * importing middlewares chain caller
 */
const next = require('./libs/middleware-chain')
/**
 * importing route handler caller
 */
const handlerCall = require('./libs/route-handler-caller')
/**
 * importing route registration handler
 */
const routeRegister = require('./libs/route-register')

/**
 * Application instance contructor like function
 *
 * @param options Object Configuration options
 */
module.exports = (options = {}) => {
  // create HTTP server instance
  const server = options.server || require('http').createServer()
  // should we prio requests processing?
  const prp = undefined === options.prioRequestsProcessing ? true : options.prioRequestsProcessing
  // registering 'request' handler
  if (prp) {
    server.on('request', (req, res) => {
      setImmediate(() => app.handle(req, res))
    })
  } else {
    server.on('request', (req, res) => {
      app.handle(req, res)
    })
  }

  // creating request router instance, considers custom router override
  const router = options.routerFactory ? options.routerFactory(options) : requestRouter(options)
  // routes holder
  const routes = {}
  // routes registration shortcut factory
  const addRoute = (methods) => (path, ...args) => {
    routeRegister(app, methods, path, args)

    // supporting method chaining for routes registration
    return app
  }

  const lookup = (req, res, next) => {
    return router.lookup(req, res)
  }
  // global middlewares holder
  const globalMiddlewares = [{
    handler: lookup,
    context: {}
  }]

  // error handler
  const errorHandler = options.errorHandler || ((err, req, res) => res.send(err))

  // the "restana" service interface
  const app = {
    /**
     * HTTP server instance
     */
    getServer () {
      return server
    },
    /**
     * Application configuration options reference
     */
    getConfigOptions () {
      return options
    },

    /**
     * Register global middleware
     *
     * @param {Object} middleware  The middleware function
     * @param {Object} context The middleware invokation context object
     */
    use: (middleware, context = {}) => {
      globalMiddlewares.splice(
        globalMiddlewares.length - 1,
        0,
        { handler: middleware, context }
      )
    },

    /**
     * Register a request handler.
     * Optionally the invokation context and pre-handler middlewares can be defined.
     *
     * @param {String} method HTTP method / verb
     * @param {String} path Request path
     * @param {Function} handler  Request handler function like (req, res, ctx) => {}
     * @param {Object} ctx  Optional request handler invokation context object. Default: {}
     * @param {Array} middlewares Optional request middlewares
     * @returns {Object} Route object
     */
    route: (method, path, handler, ctx = {}, middlewares = []) => {
      // mapping middlewares to required format { handler: Function, context: Object }
      middlewares = middlewares.map(
        middleware => (typeof middleware === 'function')
          ? { handler: middleware, context: {} }
          : middleware
      )

      // creating routing key
      const key = `[${method.toString().toUpperCase()}]${path}`
      // caching route arguments
      routes[key] = {
        method,
        path,
        handler,
        ctx,
        middlewares
      }

      const wares = middlewares.length > 0 ? [
        ...middlewares.slice(0),
        {
          context: {},
          handler: handlerCall(handler, ctx, errorHandler) // -> Function
        }
      ] : []

      // Allow override of routes, by first removing the old route
      router.off(method, path)

      // registering request handler
      router.on(method, path, (req, res, params) => {
        // populate req.params
        req.params = params

        if (middlewares.length > 0) {
          // call route middlewares and route handler
          return next(wares, req, res, errorHandler)
        } else {
          // directly call the route handler only
          // NOTE: we do this to increase performance
          return handlerCall(handler, ctx, errorHandler)(req, res)
        }
      })

      return routes[key]
    },

    /**
     * Handle on 'request' event from HTTP server instance
     *
     * @param {Object} req Request object
     * @param {Object} res Response object
     */
    handle: (req, res) => {
      // request object population
      req.originalUrl = req.url
      res.send = exts.response.send(options, req, res)

      if (globalMiddlewares.length > 1) {
        // call route middlewares and route handler
        next(globalMiddlewares, req, res, errorHandler)
      } else {
        // directly call the request router
        // NOTE: we do this to increase performance
        router.lookup(req, res)
      }
    },

    /**
     * Start application HTTP server
     *
     * @param {Number} port Optional HTTP server port. Default 3000
     * @param {String} host Optional HTTP server binding network interface
     * @returns {Promise}
     */
    start: (port = 3000, host) => new Promise((resolve, reject) => {
      server.listen(port, host, (err) => {
        if (err) reject(err)
        resolve(server)
      })
    }),

    /**
     * Close application HTTP server
     *
     * @returns {Promise}
     */
    close: () => new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err)
        resolve()
      })
    }),

    /**
     * Application routes [`[${method.toUpperCase()}]${path}`]
     *
     * @returns {Array}
     */
    routes: () => Object.keys(routes)
  }

  // exposing HTTP verbs as request routing methods
  // express.js like routes middlewares signature is supported: app.get('/', m1, m2, handler)
  methods.forEach((method) => {
    app[method] = addRoute(method)
  })

  // exposing "all" HTTP verbs as request routing registration
  app.all = addRoute(methods)

  // integrator callback
  app.callback = () => app.handle

  return app
}
