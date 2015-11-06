var util = require('util');
var fs = require('fs');
var path = require('path');
var request = require('request');
var cheerio = require('cheerio');
var urlutil = require('url');
var zlib = require('zlib');
var ejs = require('ejs');
var EventEmitter = require('events').EventEmitter;
var httprequest = require('http-request');
var async = require('async');
var mkdirp = require('mkdirp');
var jsonfile = require('jsonfile');

var mimetypes = require('./mimetypes');

var Saver = function(options) {
  EventEmitter.call(this);

  this._output_dir = options.output_dir;
  this._state_file_name = options.state_file_name || 'saver.json';

  this._state = {};
  this._logs = [];
  this._exited = false;

  if (typeof this._output_dir != 'undefined') {
    this._state = (this.loadStateSync(this._output_dir) || {});
  }

  this._save_state_on_exit = true;  
  if (typeof options.save_state_on_exit != 'undefined') {
    this._save_state_on_exit = options.save_state_on_exit;
  } 
  if (this._save_state_on_exit) {
    if (options.verbose) {
      console.log('State will be saved on exit to ' + options.output_dir);
    }
    this._exit_handler = exitHandler.bind(this);
    process.on('exit', this._exit_handler); 
  }
}

util.inherits(Saver, EventEmitter);

Saver.prototype.exit = function(err) {
  if (this._save_state_on_exit) {
    process.removeListener('exit', this._exit_handler);
  }
  exitHandler.call(this, err);
  this.emit('exit', err);
}

Saver.prototype.log = function(log) {
  console.log(log);
  this._logs.push(log);
  this.emit('log', log);
}

Saver.prototype.error = function(error) {
  console.log('[ERROR]', error);
  this._logs.push('ERROR', error);
  this.emit('error', error);
}

function exitHandler(error) {
  if (!this._exited) {
    this._exited = true;
    if (typeof this._output_dir != 'undefined') {
      console.log('State saved to: ' + this._output_dir);
      this.saveStateSync(this._output_dir);
    }
  }
}

function endsWith(str, suffix) {
  return str.indexOf(suffix, str.length - suffix.length) !== -1;
}

function ensureDirectoryExists(directory) {
  try {
    var stats = fs.statSync(directory);
    // if (stats.isDirectory()) {
    //   console.log('Directory exists: ' + directory);
    // }
  } catch (e) {
    // console.log(e);
    if (e.code == 'ENOENT') {
      // fs.mkdirSync(directory);
      mkdirp.sync(directory);
      console.log('Directory created: ' + directory);
    }
  }
}

// http://www.phaster.com/golden_hill_free_web/ghfw_connection_speed.shtml
function computeDownloadSpeed(start_time, end_time, file_size) {
  // This function returns the speed in kB/s of the user's connection.
  speed = (Math.floor((((file_size) / ((end_time - start_time) / 1000)) / 1024) * 10) / 10);
  return speed;
}
// http://stackoverflow.com/questions/2901102/how-to-print-a-number-with-commas-as-thousands-separators-in-javascript
function numberWithCommas(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

Saver.prototype.downloadFile = function(url, local_file, callback) {
  // console.log('downloadFile(): ' + url);

  var file_size = 0;
  var start_time = (new Date()).getTime();

  httprequest.get({
    url: url,
    progress: function (current, total) {
      if (file_size == 0) file_size = total;
      var current_time = (new Date()).getTime();
      var current_speed = computeDownloadSpeed(start_time, current_time, current);
      var percentage = ((current/total)*100).toFixed();
      if (current < total) {
        process.stdout.write('File downloading: ' + local_file + ' [' + numberWithCommas(current) + 
          ' ' + percentage + '% ' + current_speed + 'kB/s]\r');
      }
    }
  }, local_file, function (err, res) {
    if (err) {
      // console.log(err);
      if (err.code == 404) {
        console.log('File not found: ' + url);
      }
      return callback(err);
    }

    var result_file = res.file; // local_file;

    var content_type = res.headers['content-type'];
    if (typeof content_type != 'undefined') {
      var semicolon = content_type.indexOf(';');
      if (semicolon > 0) {
        content_type = content_type.substring(0, semicolon);  
      }
      var extensions = mimetypes.extensions(content_type);
      var extname = path.extname(result_file).toLowerCase();
      if (extensions && extensions.length > 0 
        && extensions.indexOf(extname.replace('.','')) == -1) {
        var basename = path.basename(result_file, extname);
        var dirname = path.dirname(result_file);
        var new_file = dirname + '/' + basename + '.' + extensions[0];
        fs.renameSync(result_file, new_file);
        result_file = new_file;
      }
    }

    var end_time = (new Date()).getTime();
    var avg_speed = computeDownloadSpeed(start_time, end_time, file_size);
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    console.log('File downloaded: ' + result_file + ' [' + numberWithCommas(file_size) + 
      ' 100% ' + avg_speed + 'kB/s]');

    callback(null, { 
      file: result_file, 
      file_size: file_size, 
      content_type: content_type 
    });
  });
}

Saver.prototype.downloadImage = function(image_src, options, callback) {
  // console.log('downloadImage(): image_src=' + image_src);

  var image_file = '';
  if (typeof options.image_file != 'undefined') {
    image_file = options.image_file;
  } else {
    var image_src_obj = urlutil.parse(image_src);
    image_file = path.basename(image_src_obj.pathname);  
  }
  if (typeof options.output_dir != 'undefined') {
    image_file = options.output_dir + '/' + image_file;
  }
  if (options.skip_if_exist) {
    try {
      var stats = fs.statSync(image_file);
      if (stats.isFile()) {
        console.log('File exists: ' + image_file);
        return callback(null, { file: image_file });
      }
    } catch (e) {
    }
  }

  this.downloadFile(image_src, image_file, callback);
}

Saver.prototype.downloadImages = function(images, options, callback) {
  var self = this;
  
  if (typeof options.output_dir != 'undefined') {
    ensureDirectoryExists(options.output_dir);
  }
  
  // async.each(images, function(image_info, cb) {
  async.eachLimit(images, 4, function(image_info, cb) { // limit 4 concurrent downloads at a time
    
    var image_src = '';
    var image_file = '';
    if (typeof image_info == 'string') {
      image_src = image_info;        
      var image_src_obj = urlutil.parse(image_src);
      image_file = path.basename(image_src_obj.pathname);
    } else if (typeof image_info == 'object') {
      image_src = image_info.image_src;
      image_file = image_info.image_file;
    }

    var download_options = {
      output_dir: options.output_dir,
      skip_if_exist: options.skip_if_exist,
      image_file: image_file
    };

    self.downloadImage(image_src, download_options, function(err, result) {
      if (err) {
        if (typeof image_info == 'object') {
          image_info.error = true;
          if (typeof err.code != 'undefined') {
            image_info.error_code = err.code;
          }
        }
        // return cb(err);
      } else {
        image_info.image_file = path.basename(result.file);
      }
      cb();
    });
  }, function(err) {
    if (err) return callback(err);
    callback(null, images);
  });
}

function requestWithEncoding(options, callback) {
  var req_err = null;
  try {
    var req = request.get(options);

    req.on('response', function(res) {
      var chunks = [];

      res.on('data', function(chunk) {
        chunks.push(chunk);
      });

      res.on('end', function() {
        if (!req_err) {
          var buffer = Buffer.concat(chunks);
          var encoding = res.headers['content-encoding'];
          if (encoding == 'gzip') {
            zlib.gunzip(buffer, function(err, decoded) {
              callback(err, res, decoded && decoded.toString());
            });
          } else if (encoding == 'deflate') {
            zlib.inflate(buffer, function(err, decoded) {
              callback(err, res, decoded && decoded.toString());
            })
          } else {
            callback(null, res, buffer.toString());
          }
        }
      });
    });

    req.on('error', function(err) {
      console.log('requestWithEncoding:error');
      console.log(err);
      if (!req_err) {
        req_err = err;
        callback(err);
      }
    });
  } catch(e) {
    console.log('requestWithEncoding:exception');
    console.log(e);
    if (!req_err) {
      req_err = e;
      callback(e);
    }
  }
}

Saver.prototype.downloadHtml = function(url, callback) {
  var request_options = {
    url: url,
    headers: {
      'User-Agent': 'websaver'
    },
    timeout: 60000 /* 60 seconds */
  };
  requestWithEncoding(request_options, function(error, response, html) {
    if (error) {
      // console.log(error);
      return callback(error);
    }    

    var content_type = response.headers['content-type'];
    if (content_type && content_type.indexOf('html') == -1) {
      console.log(response.headers);
      return callback(new Error('Not HTML page (' + content_type + ')'));
    }

    return callback(null, {
      requested_url: url,
      resolved_url: response.request.href,
      html: html
    });
  });
}

Saver.prototype.downloadHtml2 = function(url, callback) {
  httprequest.get({
    url: url
  }, function (err, res) {
    if (err) {
      // console.log(err);
      return callback(err);
    }
    
    var content_type = res.headers['content-type'];
    if (content_type && content_type.indexOf('html') == -1) {
      console.log(res.headers);
      return callback(new Error('Not HTML page (' + content_type + ')'));
    }

    var html = res.buffer.toString();
    return callback(null, {
      requested_url: url,
      resolved_url: url,
      html: html
    });
  });  
}

function isValidLink(link_href) {
  if (!link_href || link_href === '') return false;
  if (link_href.indexOf('#') == 0 
    || link_href.indexOf('mailto:') >= 0 
    || link_href.indexOf('javascript:') == 0) {
    return false;
  }
  return true;
}

function urlGetHost(_url) {
  if (!_url || _url == '') return '';
  var host_url = '';
  var url_obj = urlutil.parse(_url);
  if (url_obj.slashes) {
    host_url = url_obj.protocol + '//' + url_obj.host;
  } else {
    host_url = url_obj.protocol + url_obj.host;
  }
  return host_url;
}

Saver.prototype.downloadPage = function(url, callback) {
  var self = this;
  
  var request_options = {
    url: url,
    headers: {
      'User-Agent': 'websaver'
    },
    timeout: 60000 /* 60 seconds */
  };
  requestWithEncoding(request_options, function(error, response, html) {
    if (error) {
      // console.log(error);
      return callback(error);
    }    

    var content_type = response.headers['content-type'];
    if (content_type && content_type.indexOf('html') == -1) {
      console.log('Requested data is not HTML.');
      return callback(new Error('Requested data is not HTML'));
    }

    var page_url = response.request.href;
    var $ = cheerio.load(html);

    // Fix links
    var page_host_url = urlGetHost(page_url);
    var page_host_url_obj = urlutil.parse(page_host_url);
    var page_url_obj = urlutil.parse(page_url);
    $('body a').each(function(){
      var link_href = $(this).attr('href');
      if (!isValidLink(link_href)) return;
      var link_url = link_href;
      link_url = link_url.replace('http:///', '/');
      if (link_url.indexOf('//') == 0) {
        link_url = page_host_url_obj.protocol + link_url;
      }
      var link_url_obj = urlutil.parse(link_url);
      if (!link_url_obj.host) {
        if (link_url.indexOf('/') == 0) {
          link_url = urlutil.resolve(page_host_url_obj, link_url_obj);
        } else {
          link_url = urlutil.resolve(page_url_obj, link_url_obj);
        }
      } else {
        link_url = urlutil.format(link_url_obj);
      }
      // if ($(this).attr('href') != link_url) {
      //   console.log($(this).attr('href'), ' --> ' + link_url);
      // }
      $(this).attr('href', link_url);
    });

    callback(null, { url: page_url, $: $ });
  });
}

Saver.prototype.saveHtmlSync = function(output_file, html) {
  var output_dir = path.dirname(output_file);
  ensureDirectoryExists(output_dir);

  fs.writeFileSync(output_file, html, 'utf8');
}

Saver.prototype.loadStateSync = function(from_dir) {
  var state = null;
  var state_file = from_dir + '/' + this._state_file_name;
  try {
    var stats = fs.statSync(state_file);
    if (stats.isFile()) {
      state = jsonfile.readFileSync(state_file);
    }
  } catch (e) {
  }
  if (state != null) {
    this._state = state;
  }
  return state;
}

Saver.prototype.saveStateSync = function(to_dir) {
  var err = null;
  var state_file = to_dir + '/' + this._state_file_name;
  try {
    jsonfile.writeFileSync(state_file, this._state, { spaces: 2 });
  } catch (e) {
    err = e;
  }
  return err;
}

Saver.prototype.getState = function() {
  return this._state;
}

Saver.prototype.setStateData = function(key, value) {
  this._state[key] = value;
}

Saver.prototype.getStateData = function(key) {
  return this._state[key];
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

Saver.prototype.updateStateData = function(key, update, save_to_file) {
  if (typeof this._state[key] == 'object' && typeof update == 'object') {
    updateObject(this._state[key], update);
  } else {
    this._state[key] = update;
  }
  if (save_to_file && typeof this._output_dir != 'undefined') {
    this.saveStateSync(this._output_dir);
  }
}

// for array data only
Saver.prototype.pushStateData = function(key, value, save_to_file) {
  if (Object.prototype.toString.call(this._state[key]) === '[object Array]') {
    this._state[key].push(value);
  } else if (typeof this._state[key] == 'undefined') {
    this._state[key] = [];
    this._state[key].push(value);
  }
  if (save_to_file && typeof this._output_dir != 'undefined') {
    this.saveStateSync(this._output_dir);
  }
}

Saver.prototype.deleteStateData = function(key, save_to_file) {
  if (typeof this._state[key] != 'undefined') {
    delete this._state[key];
  }
  if (save_to_file && typeof this._output_dir != 'undefined') {
    this.saveStateSync(this._output_dir);
  }
}

function runEJSScript(file, data, options, callback) {
  fs.readFile(file, 'utf8', function (err, script) {
    if (err) {
      return callback(new Error('Reading script file failed! ' + file));
    }

    if (typeof data.options.script_file != 'undefined') {
      var options_script_file_path = path.resolve(data.options.script_file);
      var script_dir = path.dirname(path.resolve(file));
      var relative_path = path.relative(script_dir, options_script_file_path);
      script += '<%include ' + relative_path + '%>';
    }

    var resultHtml = '';
    var result = {};
    try {
      resultHtml = ejs.render(script, data, options);
    } catch (e) {
      console.log(e);
      return callback(e);
    }

    // Pass back data
    return callback(null, data);
  });
}

Saver.prototype.renderTemplate = function(file, data, callback) {
  var template_file = __dirname + "/../templates/" + file;
  fs.readFile(template_file, 'utf8', function (err, template) {
    if (err) {
      return callback(new Error('Reading template file failed!'));
    }

    var resultHtml = '';
    try {
      resultHtml = ejs.render(template, data);
    } catch (e) {
      console.log(e);
      return callback(e);
    }

    // Pass back data
    return callback(null, {
      html: resultHtml,
      data: data
    });
  }); 
}

// options
// {
//   page_url: String,
//   output_dir: String
// }
Saver.prototype.start = function(options, callback) {
  var self = this;

  console.log('Page URL: ' + options.page_url);

  self.downloadHtml(options.page_url, function(err, result) {
    if (err) {
      return callback(err);
    }

    var page = {
      url: result.resolved_url
    };

    self.setStateData('url', result.resolved_url);
    
    var $ = cheerio.load(result.html);
    var script_file = __dirname + "/../scripts/saver-base.ejs";
    var script_data = {
      filename: script_file,
      $: $,
      page: page,
      saver: self,
      options: options,
      require: require,
      cheerio: cheerio,
      urlutil: urlutil,
      path: path,
      async: async
    };
    var script_options = {};
    runEJSScript(script_file, script_data, {}, function(err, result) {
      if (err) {
        return callback(err);
      }
      callback();
    });
  });
}

module.exports = Saver;