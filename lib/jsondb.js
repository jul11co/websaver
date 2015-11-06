var util = require('util');
var fs = require('fs');
var path = require('path');
var EventEmitter = require('events').EventEmitter;
var mkdirp = require('mkdirp');
var jsonfile = require('jsonfile');
var moment = require('moment');

var JsonDB = function(options) {
  EventEmitter.call(this);

  this._dbfile = options.file;

  this._db = {};
  this._exited = false;

  this.on('exit', exitHandler.bind(this));

  if (typeof this._dbfile != 'undefined') {
    this._db = (this.load(this._dbfile) || {});
  }

  this._save_on_exit = true;
  if (typeof options.save_on_exit != 'undefined') {
    this._save_on_exit = options.save_on_exit;
  }
  if (this._save_on_exit) {
    this._exit_handler = exitHandler.bind(this);
    process.on('exit', this._exit_handler);
  }
}

util.inherits(JsonDB, EventEmitter);

JsonDB.prototype.exit = function(err) {
  if (this._save_on_exit) {
    process.removeListener('exit', this._exit_handler);
  }
  exitHandler.call(this, err);
  this.emit('exit', err);
}

function exitHandler(code, reason) {
  if (!this._exited) {
    this._exited = true;
    if (typeof this._dbfile != 'undefined') {
      this.save(this._dbfile);
    }
  }
}

JsonDB.prototype.load = function(dbfile) {
  var db = null;
  try {
    var stats = fs.statSync(dbfile);
    if (stats.isFile()) {
      db = jsonfile.readFileSync(dbfile);
    }
  } catch (e) {
  }
  if (db != null) {
    this._dbfile = dbfile;
    this._db = db;
  }
  return db;
}

JsonDB.prototype.save = function(dbfile) {
  var err = null;
  try {
    jsonfile.writeFileSync(dbfile, this._db, { spaces: 2 });
  } catch (e) {
    err = e;
  }
  return err;
}

JsonDB.prototype.toMap = function() {
  return this._db;
}

JsonDB.prototype.set = function(key, value) {
  this._db[key] = value;
}

JsonDB.prototype.get = function(key) {
  return this._db[key];
}

function updateObject(original, update, verbose) {
  if (typeof original == 'object' && typeof update == 'object') {
    for (var prop in update) {
      if (verbose) {
        console.log('Update prop "' + prop + '":', 
          ' (' + typeof original[prop] + ' --> ' + typeof update[prop] + ')');
      }
      if (typeof original[prop] == 'object' && typeof update[prop] == 'object') {
        updateObject(original[prop], update[prop], verbose);
      } else {
        original[prop] = update[prop];
      }
    }
  } else {
    original = update;
  }
}

JsonDB.prototype.update = function(key, update, save_to_file) {
  if (typeof this._db[key] == 'object' && typeof update == 'object') {
    updateObject(this._db[key], update);
  } else {
    this._db[key] = update;
  }
  if (save_to_file && typeof this._dbfile != 'undefined') {
    this.save(this._dbfile);
  }
}

// for array data only
JsonDB.prototype.push = function(key, value, save_to_file) {
  if (Object.prototype.toString.call(this._db[key]) === '[object Array]') {
    this._db[key].push(value);
  } else if (typeof this._db[key] == 'undefined') {
    this._db[key] = [];
    this._db[key].push(value);
  }
  if (save_to_file && typeof this._dbfile != 'undefined') {
    this.save(this._dbfile);
  }
}

JsonDB.prototype.delete = function(key, save_to_file) {
  if (typeof this._db[key] != 'undefined') {
    delete this._db[key];
  }
  if (save_to_file && typeof this._dbfile != 'undefined') {
    this.save(this._dbfile);
  }
}

module.exports.JsonDB = JsonDB;