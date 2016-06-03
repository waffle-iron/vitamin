
var _ = require('underscore'),
    Promise = require('bluebird'),
    ModelNotFound = require('./errors').ModelNotFoundError

module.exports = Query

/**
 * Query Builder constructor
 * 
 * @param {Object} driver
 * @constructor
 */
function Query(driver) {
  this._where     = {}
  this._rels      = {}
  this._select    = []
  this._order     = []
  this._distinct  = false
  this._offset    = undefined
  this._limit     = undefined
  this._from      = undefined
  
  // make `driver` a read-only property
  Object.defineProperty(this, 'driver', { value: driver })
}

/**
 * Set the relationships that should be eager loaded
 * Use case:
 *   with(
 *     'tags',
 *     { 'comments': ['author', 'likes'] },
 *     { 'editor': function (q) { q.select('fullname') } }
 *   )
 * 
 * @param {Array|String} related
 * @return Query instance
 */
Query.prototype.with = function _with(related) {
  var rels = {}
  
  if (! _.isArray(related) ) related = _.toArray(arguments)
  
  _.each(related, function (value) {
    if ( _.isString(value) ) rels[value] = function noop(q) {}
    else _.extend(rels, value)
  })
  
  this._rels = rels 
  return this
}

/**
 * Load the relationships for the models
 * 
 * @param {Array} models
 * @return Promise instance
 */
Query.prototype.loadRelated = function loadRelated(models) {
  return Promise
    .bind(this)
    .map(_.keys(this._rels), function iterateRelations(name) {
      var relation = this._getRelation(name, this._rels[name])
      
      return relation.eagerLoad(name, models)
    })
}

/**
 * Set the model being queried
 * 
 * @param {Model} model
 * @return Query instance
 */
Query.prototype.setModel = function setModel(model) {
  this.model = model
  return this
}

/**
 * Add a basic where clause to the query
 * use cases:
 *   where('name', "John")
 *   where('status', "$ne", "draft")
 *   where({ name: "Rita", age: 18 })
 *   where('price', { $gt: 100, $lte: 200 })
 * 
 * @param {String|Object} key
 * @param {String} op
 * @param {any} value
 * @return Query instance
 */
Query.prototype.where = function where(key, op, val) {
  var cond = {}
  
  switch (arguments.length) {
    case 2:
      val = op
      op = _.isArray(val) ? "$in" : "$eq"
    
    case 3:
      // accept sub queries
      if ( val instanceof Query ) val = val.assemble()
      
      cond = _object(key, _object(op, val))
    
    case 1:
      cond = _.isObject(key) ? key : {}
  }
  
  _.extend(this._where, cond)
  return this
}

/**
 * Add a `Where in` clause to the query
 * 
 * @param {String} key
 * @param {Array} val
 * @return Query instance
 */
Query.prototype.whereIn = function whereIn(key, val) {
  return this.where(key, "$in", val)
}

/**
 * Add an "or where" clause to the query
 * Example: orWhere({name: "foo"}, {name: "bar"})
 * 
 * @param {Array} clauses
 * @return Query instance
 */
Query.prototype.orWhere = function orWhere(clauses) {
  return this.where({ $or: _.toArray(arguments) })
}

/**
 * Set the source name which the query is targeting
 * 
 * @param {String} from
 * @return Query instance
 */
Query.prototype.from = function from(from) {
  this._from = from
  return this
}

/**
 * Set the fields to be selected
 * 
 * @param {String} field
 * @return Query instance
 */
Query.prototype.select = function select(field) {
  var args = _.isArray(field) ? field : _.toArray(arguments)
  
  this._select = _.uniq(this._select.concat(args))
  return this
}

/**
 * Force the query to fetch only distinct results
 * 
 * @return Query instance
 */
Query.prototype.distinct = function distinct() {
  this._distinct = true
  return this
}

/**
 * Alias to set the "limit" value of the query
 * 
 * @param {Number} n
 * @return Query instance
 */
Query.prototype.take = function take(n) {
  this._limit = Number(n)
  return this
}

/**
 * Alias to set the "offset" value of the query
 * 
 * @param {Number} n
 * @return Query instance
 */
Query.prototype.skip = function skip(n) {
  this._offset = Number(n)
  return this
}

/**
 * Add an "order by" clauses to the query
 * 
 * @param {String} field
 * @return Query instance
 */
Query.prototype.order = function order(field) {
  var args = _.isArray(field) ? field : _.toArray(arguments)
  
  this._order = _.uniq(this._order.concat(args))
  return this
}

/**
 * Fetch one record from the database
 * 
 * @param {Function} cb optional callback
 * @return {Promise}
 */
Query.prototype.fetch = function fetch(cb) {
  return Promise
    .bind(this)
    .then(function () {
      return this.driver.fetch(this.assemble())
    })
    .then(function (resp) {
      if ( _.isEmpty(resp) ) 
        return Promise.reject(new ModelNotFound)
      
      return this.model.setData(resp, true)
    })
    .tap(function (model) {
      return this.loadRelated([model])
    })
    .nodeify(cb)
}

/**
 * Fetch many records from th database
 * 
 * @param {Function} cb (optional)
 * @return {Promise}
 */
Query.prototype.fetchAll = function fetchAll(cb) {
  return Promise
    .bind(this)
    .then(function () {
      return this.driver.fetchAll(this.assemble())
    })
    .then(function (resp) {
      return _.map(resp, function (data) {
        return this.newInstance(data)
      }, this.model)
    })
    .tap(this.loadRelated)
    .nodeify(cb)
}

/**
 * Insert a new record into the database
 * 
 * @param {Object} data
 * @return {Promise}
 */
Query.prototype.insert = function insert(data) {
  return this.driver.insert(data, this.assemble())
}

/**
 * Update a record in the database
 * 
 * @param {Object} data
 * @return {Promise}
 */
Query.prototype.update = function update(data) {
  return this.driver.update(data, this.assemble())
}

/**
 * Delete a record from the database
 * 
 * @return {Promise}
 */
Query.prototype.destroy = function destroy() {
  return this.driver.destroy(this.assemble())
}

/**
 * Get the object representation of the query.
 * 
 * @return object
 */
Query.prototype.assemble = function assemble() {
  var q = {}, 
      props = ['select', 'distinct', 'from', 'where', 'order', 'offset', 'limit']
  
  _.each(props, function _assemblePieces(name) {
    var prop = this['_' + name]
    
    // skip empty arrays and objects
    if ( _.isEmpty(prop) ) return
    
    if ( _.isArray(prop) ) prop = prop.slice()
    
    if ( _.isObject(prop) ) prop = _.clone(prop)
    
    q[name] = prop
  }, this)
  
  return q
}

/**
 * Get the relation instance for the given relation name
 * 
 * @param {String} name
 * @return Relation instance
 * @private
 */
Query.prototype._getRelation = function _getRelation(name, custom) {
  var relationFn = this.model[name]
  
  if (! relationFn ) throw new Error("Undefined '" + name + "' relationship")
  
  return this._initRelation(relationFn.call(this.model), custom)
}

/**
 * Customize the relationship query
 * 
 * @param {Relation} relation
 * @param {Array|Function} custom
 * @return Relation instance
 * @private
 */
Query.prototype._initRelation = function _initRelation(relation, custom) {
  // set nested models
  if ( _.isArray(custom) ) relation.with(custom)
  
  // use custom constraints
  if ( _.isFunction(custom) ) custom.call(null, relation.query)
  
  return relation
}

/**
 * Helper to create an plain object with one `key` and `value`
 * 
 * @param {String} key
 * @param {any} val
 * @return {Obejct}
 */
function _object(key, val) {
  if ( _.isObject(val) ) return val
  
  var o = {}
  o[key] = val
  return o
}
