'use strict';

var path = require('path');
var loaderUtils = require('loader-utils');

var MIMES = {
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'webp': 'image/webp',
  'png': 'image/png'
};

var EXTS = {
  'image/jpeg': 'jpg',
  'image/png': 'png'
};

module.exports = function loader(content) {
  var loaderCallback = this.async();
  var parsedResourceQuery = this.resourceQuery ? loaderUtils.parseQuery(this.resourceQuery) : {};
  var config = Object.assign({}, loaderUtils.getOptions(this), parsedResourceQuery);
  var outputContext = config.context || '';
  var outputPlaceholder = Boolean(config.placeholder) || false;
  var placeholderSize = parseInt(config.placeholderSize, 10) || 40;
  // JPEG compression
  var quality = parseInt(config.quality, 10) || 85;
  // Useful when converting from PNG to JPG
  var background = config.background;
  // Specify mimetype to convert to another format
  var mime = void 0;
  var ext = void 0;
  if (config.format) {
    if (!MIMES.hasOwnProperty(config.format)) {
      return loaderCallback(new Error('Format "' + config.format + '" not supported'));
    }
    mime = MIMES[config.format];
    ext = EXTS[mime];
  } else {
    ext = path.extname(this.resourcePath).replace(/\./, '');
    mime = MIMES[ext];
    if (!mime) {
      return loaderCallback(new Error('No mime type for file with extension ' + ext + 'supported'));
    }
  }

  var name = (config.name || '[hash]-[width].[ext]').replace(/\[ext\]/ig, ext);

  var adapter = config.adapter || require('./adapters/jimp');
  var loaderContext = this;

  // The config that is passed to the adatpers
  var adapterOptions = Object.assign({}, config, {
    quality,
    background
  });

  var min = config.min !== undefined ? parseInt(config.min, 10) : undefined;
  var max = config.max !== undefined ? parseInt(config.max, 10) : undefined;
  var steps = config.steps === undefined ? 4 : parseInt(config.steps, 10);

  var generatedSizes = void 0;
  if (typeof min === 'number' && max) {
    generatedSizes = [];

    for (var step = 0; step < steps; step++) {
      var _size = min + (max - min) / (steps - 1) * step;
      generatedSizes.push(Math.ceil(_size));
    }
  }

  var sizes = parsedResourceQuery.size || parsedResourceQuery.sizes || generatedSizes || config.size || config.sizes || [Number.MAX_SAFE_INTEGER];

  if (!sizes) {
    return loaderCallback(null, content);
  }

  if (config.disable) {
    // emit original content only
    var f = loaderUtils.interpolateName(loaderContext, name, {
      context: outputContext,
      content: content
    }).replace(/\[width\]/ig, '100').replace(/\[height\]/ig, '100');
    loaderContext.emitFile(f, content);
    var p = '__webpack_public_path__ + ' + JSON.stringify(f);
    return loaderCallback(null, 'module.exports = {srcSet:' + p + ',images:[{path:' + p + ',width:100,height:100}],src: ' + p + ',toString:function(){return ' + p + '}};');
  }

  var createFile = function createFile(_ref) {
    var data = _ref.data,
        width = _ref.width,
        height = _ref.height;

    var fileName = loaderUtils.interpolateName(loaderContext, name, {
      context: outputContext,
      content: data
    }).replace(/\[width\]/ig, width).replace(/\[height\]/ig, height);

    loaderContext.emitFile(fileName, data);

    return {
      src: '__webpack_public_path__ + ' + JSON.stringify(fileName + ' ' + width + 'w'),
      path: '__webpack_public_path__ + ' + JSON.stringify(fileName),
      width: width,
      height: height
    };
  };

  var createPlaceholder = function createPlaceholder(_ref2) {
    var data = _ref2.data;

    var placeholder = data.toString('base64');
    return JSON.stringify('data:' + (mime ? mime + ';' : '') + 'base64,' + placeholder);
  };

  var img = adapter(loaderContext.resourcePath);
  return img.metadata().then(function (metadata) {
    var promises = [];
    var widthsToGenerate = new Set();

    (Array.isArray(sizes) ? sizes : [sizes]).forEach(function (size) {
      var width = Math.min(metadata.width, parseInt(size, 10));

      // Only resize images if they aren't an exact copy of one already being resized...
      if (!widthsToGenerate.has(width)) {
        widthsToGenerate.add(width);
        promises.push(img.resize({
          width,
          mime,
          options: adapterOptions
        }));
      }
    });

    if (outputPlaceholder) {
      promises.push(img.resize({
        width: placeholderSize,
        options: adapterOptions,
        mime
      }));
    }

    return Promise.all(promises).then(function (results) {
      return outputPlaceholder ? {
        files: results.slice(0, -1).map(createFile),
        placeholder: createPlaceholder(results[results.length - 1])
      } : {
        files: results.map(createFile)
      };
    });
  }).then(function (_ref3) {
    var files = _ref3.files,
        placeholder = _ref3.placeholder;

    var srcset = files.map(function (f) {
      return f.src;
    }).join('+","+');

    var images = files.map(function (f) {
      return '{path:' + f.path + ',width:' + f.width + ',height:' + f.height + '}';
    }).join(',');

    var firstImage = files[0];

    loaderCallback(null, 'module.exports = {' + 'srcSet:' + srcset + ',' + 'images:[' + images + '],' + 'src:' + firstImage.path + ',' + 'toString:function(){return ' + firstImage.path + '},' + 'placeholder: ' + placeholder + ',' + 'width:' + firstImage.width + ',' + 'height:' + firstImage.height + '};');
  }).catch(function (err) {
    return loaderCallback(err);
  });
};

module.exports.raw = true; // get buffer stream instead of utf8 string