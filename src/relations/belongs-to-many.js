
var _ = require('underscore'),
    Model = require('../model'),
    Relation = require('./base'),
    Promise = require('bluebird')

var BelongsToMany = Relation.extend({
  
  /**
   * BelongsToMany relationship constructor
   * 
   * @param {Model} parent model of the relationship
   * @param {Model} related model
   * @param {String} pivot table or collection name
   * @param {String} rk related model key
   * @param {String} pk parent model key
   */
  constructor: function BelongsToMany(parent, related, pivot, rk, pk) {
    Relation.apply(this, [parent, related])
    
    // use a default pivot model
    if ( pivot ) {
      pivot = Model.extend({
        $table: String(pivot)
      })
      
      this.through(pivot, rk, pk)
    }
  },
  
  /**
   * Use a custom pivot model for the relationship
   * 
   * @param {Model} model constructor
   * @param {String} rk related model key
   * @param {String} pk parent model key
   * @return BelongsToMany instance
   */
  through: function through(model, rk, pk) {
    this.pivot = model.factory()
    this.localKey = pk
    this.otherKey = rk
    
    return this
  },
  
  /**
   * Attach a model the the parent
   * 
   * @param {Any} id
   * @param {Function} cb
   * @return Promise instance
   */
  attach: function attach(id, cb) {
    if ( _.isArray(id) ) return this.attachMany(id, cb)
    
    var pivot = this.pivot.newInstance()
    
    // set pivot model properties
    pivot.set(this.localKey, this.parent.getId())
    pivot.set(this.otherKey, ( id instanceof Model ) ? id.getId() : id)
    
    return pivot.save(cb)
  },
  
  /**
   * Attach many models to the parent
   * 
   * @param {Array} ids
   * @param {Function} cb (optional)
   * @return Promise instance
   */
  attachMany: function attachMany(ids, cb) {
    return Promise
      .bind(this, ids)
      .map(this.attach)
      .nodeify(cb)
  },
  
  /**
   * Detach one or many models from the parent
   * 
   * @param {Any} ids
   * @param {Function} cb (optional)
   * @return Promise instance
   */
  detach: function detach(ids, cb) {
    var query = this._newPivotQuery()
    
    // detach all related models
    if ( _.isFunction(ids) ) {
      cb = ids
      ids = []
    }
    
    // in case it is a model instance
    if ( ids instanceof Model ) ids = ids.getId()
    
    if (! _.isArray(ids) ) ids = [ids]
    
    if ( ids.length > 0 ) query.whereIn(this.otherKey, ids)
    
    return Promise.resolve(query.destroy()).nodeify(cb)
  },
  
  /**
   * Apply constraints on the relation query
   * 
   * @private
   */
  _applyConstraints: function _applyConstraints() {
    var other = this.related.getKeyName(),
        subQuery = this._newPivotQuery()
    
    this.query.whereIn(other, subQuery.select(this.otherKey).distinct())
  },
  
  /**
   * Apply eager constraints on the relation query
   * 
   * @param {Array} models
   * @private
   */
  _applyEagerConstraints: function _applyEagerConstraints(models) {
    var subQuery = this._newPivotQuery(),
        local = this.parent.getKeyName(),
        other = this.related.getKeyName()
    
    subQuery.whereIn(this.localKey, this._getKeys(models, local))
    
    this.query.whereIn(other, subQuery.select(this.otherKey).distinct())
  },
  
  /**
   * Create a new pivot query
   * 
   * @return Query instance
   */
  _newPivotQuery: function _newPivotQuery() {
    var query = this.pivot.newQuery()
    
    return query.where(this.localKey, this.parent.getId())
  }
  
})

// use mixin
_.assign(BelongsToMany.prototype, require('./mixins/one-to-many'))

module.exports = BelongsToMany