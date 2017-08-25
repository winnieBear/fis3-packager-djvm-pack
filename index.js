var path = require('path');
var _ = fis.util;
var extend = require('extend');

var options = {
  selectors: {
    'js': /<(script)([^>]*)>((?:.|\r\n)*?)<\/script>/g,
    'css': /<(link)([^>]*?)\/?>/g
  },
  placeholder: {
    'css': '__$MERGE_CSS$__',
    'js': '__$MERGE_JS$__'
  }
}

Array.prototype.pushUnique = Array.prototype.pushUnique || function (item) {
  if (this.indexOf(item) == -1) {
      this.push(item);
      return true;
  }
  return false;
}
/**
 * 模板解释
 * @param {String} tmpl 模板字符串
 * @param {Object} paramObj 数据
 * @return {String} 返回解释后的字符串
 */
var templates = {
  'js': '<script $attributes$ src="$src$"></script>',
  'css': '<link $attributes$ href="$src$"/>'
};
function parseTmpl(tmpl, paramObj) {
  paramObj = paramObj || paramObj;

  if (typeof tmpl === 'string') {
      return tmpl.replace(/\$([_a-zA-Z0-9]*)\$/g, function (m, n) {
          return typeof paramObj[n] === 'undefined' ? '' : paramObj[n];
      });
  } else {
      return tmpl;
  }
}

var arrayMerge = function(arr1, arr2){
  for (var i = 0, len = arr2.length; i < len; i++){
      arr1.pushUnique(arr2[ i ]);
  }

  return arr1;
}
/**
 * 解释属性字符串
 * @param {String} attrStr 属性字符串
 * @returns {Object} 属性对象
 */
function parseAttributes(attrStr) {
  var reAttributes = /([^=<>\"\'\s]+)\s*(?:=\s*["']?([^"']*)["']?)?/g;
  var result = {};
  var match;

  if (attrStr) {
      while (match = reAttributes.exec(attrStr)) {
          result[match[1]] = match[2] || true;
      }
  }

  return result;
}

/**
 * 获取匹配指定正则表达式的TAG列表
 * @param {String} rawHtml 待匹配的HTML源
 * @param {Regexp} reTag 指定的正则表达式
 * @returns {Array} 匹配的TAG列表
 */
function getTags(rawHtml, reTag) {
  var result = [];
  var match, attributes;

  while (match = reTag.exec(rawHtml)) {
      attributes = parseAttributes(match[2] || '');

      result.push({ name: match[1], attributes: attributes, raw: match[0] });
  }

  return result;
}



function generateCombinedFile(type, files, attributes) {
  // debugger;
  if (!files.length) {
      return '';
  }
  var attrStr = [];
  var filesMaxIdx = files.length - 1;

  attributes = extend(true, {}, attributes);
  delete attributes.src;
  delete attributes.href;

  var arrFiles = files;


  for (var attrName in attributes) {
      attrStr.push(attrName + '="' + attributes[attrName] + '"');
  }


  var url = this.options.combUrlPre + this._getComboUrl(arrFiles);

  // return parseTmpl(templates[type], { src: encodeURI(url), attributes: attrStr.join(' ') });
  return parseTmpl(templates[type], { src: url, attributes: attrStr.join(' ') });
};

// 提取页面中的link和script标签链接的资源
function extraLinkResource(rawHtml, type, key, fileId) {
  var arrLinkRes = [];
  var placeholder = options.placeholder[ type ];
  var regPlaceholder = new RegExp(placeholder.replace(/\$/g, '\\$') + '=(\'|\")(\\S+)\\1');
  var res = regPlaceholder.exec(rawHtml);
  if (res === null) {
    // 找不到匹配的link或script资源
    return {
      rawHtml: rawHtml,
      arrLinkRes: arrLinkRes
    };
  }

  var packFile = res[ 2 ];
  if (!packFile) {
    var err = fileId + 'has no placeholder ' + placeholder;
    console.error(err);
    throw new Error(err);
  }

  placeholder = res[ 0 ];
  var allMatchTags = getTags(rawHtml, options.selectors[ type ]);

  var attributes = {};
  attributes[ key ] = packFile;

  for (var i = 0, len = allMatchTags.length; i < len; i++){
    var tag = allMatchTags[ i ];
    var url = tag[ 'attributes' ][ key ];

    if (!url) {
      continue;
    }
    // 网络连接的资源不做处理
    if (url.indexOf('//') === 0 ||url.indexOf('http') === 0) {
        continue;
    }

    // link 只处理css/scss文件
    if (type === 'css' && !/\.(css|scss)$/.test(url)) {
      continue;
    }

    arrLinkRes.push(url);
    rawHtml = rawHtml.replace(tag.raw, '');
  }

  // rawHtml = rawHtml.replace(placeholder, generateCombinedFile(type, arrPackFile, attributes));


  return {
      rawHtml: rawHtml,
      arrLinkRes: arrLinkRes,
      placeholder: placeholder,
      packFile: packFile
  };
};

// 查找页面的依赖资源
function extraContentDeps(content, fileId) {
  var deps = {
    js: {
      packFile: '',
      placeholder: '',
      arrLink: []
    },
    css: {
      packFile: '',
      placeholder: '',
      arrLink: []
    }
  };
  var ret = extraLinkResource(content, 'js', 'src', fileId);
  deps[ 'js' ] = {
    packFile: ret[ 'packFile' ] || '',
    placeholder:ret[ 'placeholder' ] || '',
    arrLink: ret[ 'arrLinkRes' ] || []
  }
  content = ret[ 'rawHtml' ];

  ret = extraLinkResource(content, 'css', 'href', fileId);
  deps[ 'css' ] = {
    packFile: ret[ 'packFile' ] || '',
    placeholder: ret[ 'placeholder' ] || '',
    arrLink: ret[ 'arrLinkRes' ] || []
  };

  content = ret[ 'rawHtml' ];

  return {
    content: content,
    deps: deps
  }
}

var arrPackedCss = [];
var arrPackedJs = [];

function getWidgetDeps(w, map) {
  // console.info('_getWidgetDeps ...');
  var arrDepJs = [];
  var arrDepCss = [];
  // var arrJsMod = [];
  // var arrWidgetConf = [];
  function buildDeps(arrDeps) {
      arrDeps.forEach(function (deps) {
          var depsId = deps, vmPath;

          var depsObj = map[depsId];
          if (!depsObj) {
            throw new Error(depsId + 'is not in map!!');
          }
          var hisDeps = depsObj['deps'] || [];
          if (hisDeps && hisDeps.length) {
              buildDeps(hisDeps);
          }

          var type = depsObj.type;
          // var uri = depsObj.uri;

          switch (type) {
              // case 'vm':

              //     // 检查deps中的js，添加到arrJsMod里
              //     // arrJsMod中只放每一个vm同名依赖的js模块，它的依赖已经Dep中提前加载了
              //     // var depsIdPre = depsId.replace(/(.*?)(\.vm)$/, '$1');
              //     // hisDeps.map(function (item) {
              //     //     if (item === depsIdPre + '.js') {
              //     //         var modId = map[item] && map[item]['extras']['moduleId'];
              //     //         arrJsMod.push({
              //     //             moduleId: '"' + modId + '"',
              //     //             widgetId: deps.idf
              //     //         });
              //     //     }
              //     // });

              //     break;
              case 'js':
                  if (!~arrPackedJs.indexOf(depsId)) {
                    arrDepJs.pushUnique(depsId);
                  }
                  break;
              case 'css':
                  if (!~arrPackedCss.indexOf(depsId)) {
                    arrDepCss.pushUnique(depsId);
                  }
                  break;
              default:
                  break;
          } //end of switch
      }); //end of forEach

  }

  if (!Array.isArray(w)) {
      w = [w];
  }
  buildDeps(w);

  return {
    arrDepCss: arrDepCss,
    arrDepJs: arrDepJs
  };

}

var hasPackedPage = {};
var haspackedRes = {};
var layoutMap = {};
var mergedMap = {};

function packItem(ret, fileId) {
  var isLayout;
  if (/^page\/layout\/(?:.+)/.test(fileId)) {
    isLayout = true;
  }
  if (isLayout && hasPackedPage[ fileId ]) {
    return;
  }
  console.log('packItem %s', fileId);
  var resMap = ret[ 'map' ]['res'];
  var thisMap = resMap[ fileId ];
  // find depend layout
  var arrRequire = thisMap[ 'deps' ] || [];
  var depLayout, layoutInd;
  var arrRequireWidget = [];
  var arrRequireCss = [];
  var arrRequireJs = [];


  arrRequire.forEach(function (depItem, ind) {
    if (/^page\/layout\/(?:.+)/.test(depItem)) {
      depLayout = depItem;
      if (!layoutMap[ fileId ]) {
        layoutMap[ fileId ] = [ depItem ];
      }
    }

    if (/^widget\/(?:.+)/.test(depItem)) {
      arrRequireWidget.push(depItem);
    }

    if (/\.(css|scss)$/.test(depItem)) {
      arrRequireCss.push(depItem);
    }

    if (/\.(js)$/.test(depItem)) {
      arrRequireJs.push(depItem);
    }

  });

  var arrAsyncJs = [];
  var arrAsyncCss = [];
  var arrAsync = (resMap[fileId][ 'extras' ] && resMap[fileId][ 'extras' ][ 'async' ]) || [];
  arrAsync.forEach(function (asyncItem) {
    if (/\.(css|scss)$/.test(asyncItem)) {
      arrAsyncCss.push(asyncItem);
    }

    if (/\.(js)$/.test(asyncItem)) {
      arrAsyncJs.push(asyncItem);
    }
  });

  console.log('dep Layout:%s', depLayout || 'none');
  if (depLayout) {
    arrRequire.splice(layoutInd, 1);
    if (!hasPackedPage[ depLayout ]) {
      packItem(ret, depLayout);
    }

    if (layoutMap[ depLayout ]) {
      layoutMap[ fileId ] = layoutMap[ fileId ].concat(layoutMap[ depLayout ]);
    }
  }

  // 分析依赖的widget依赖的css和js
  var wDeps = getWidgetDeps(arrRequireWidget, resMap);

  //合并所有的依赖
  var deps = {};
  deps[ 'js' ] = {};
  deps[ 'js' ][ 'arrRequires' ] = [].concat(wDeps['arrDepJs'],arrRequireJs);
  deps[ 'js' ][ 'arrAsync' ] = [].concat(arrAsyncJs);

  deps[ 'css' ] = {};
  deps[ 'css' ][ 'arrRequires' ] = [].concat(wDeps['arrDepCss'],arrRequireCss);
  deps[ 'css' ][ 'arrAsync' ] =  [].concat(arrAsyncCss);



  var ids = ret.ids;
  var file = ids[ fileId ];
  var content = file.getContent();
  var res = extraContentDeps(content, file.id);
  content = res[ 'content' ];

  // res['deps'] = {
  //   js: {
  //     packFile: '',
  //     placeholder: '',
  //     arrLink: []
  //   },
  //   css: {
  //     packFile: '',
  //     placeholder: '',
  //     arrLink: []
  //   }
  // };
  res[ 'deps' ][ 'js' ][ 'arrLink' ] = transformUrlToFileId(ret,res[ 'deps' ][ 'js' ][ 'arrLink' ]);
  res[ 'deps' ][ 'css' ][ 'arrLink' ] = transformUrlToFileId(ret,res[ 'deps' ][ 'css' ][ 'arrLink' ]);
  deps[ 'js' ] = extend(true, deps[ 'js' ], res[ 'deps' ][ 'js' ]);
  deps[ 'css' ] = extend(true, deps[ 'css' ], res[ 'deps' ][ 'css' ]);

  console.log('%s deps:%s', fileId, JSON.stringify(deps, null, 4));

  // 替换/合成文件，替换占位符
  // arrRequires,arrLink,arrAsync
  // js handle
  var arrTmpMerge;
  var placeholder;
  var arrPackFile;
  [ 'js', 'css' ].forEach(function (resType) {
    arrTmpMerge = [];
    arrPackFile = [];
    placeholder = deps[ resType ][ 'placeholder' ];
    if (placeholder) {
      [].concat(
        deps[ resType ][ 'arrRequires' ],
        deps[ resType ][ 'arrLink' ],
        deps[ resType ][ 'arrAsync' ])
        .forEach(function (resId) {
          if (mergedMap[ resId ] && layoutMap[ fileId ] && isPackedInLayout(mergedMap[ resId ], layoutMap[ fileId ])) {
            // 如果该资源已经被打包在页面继承的layout中，则跳过该资源
            console.warn('%s has packed in layout', resId);
            return;
          }
          var uri, url;
          // dev mode:insert all url
          if (env !== 'prod') {
            uri = resMap[ resId ][ 'uri' ];
          } else {
            arrPackFile.push(resId);
            var packFilePath = deps[ resType ][ 'packFile' ];
            uri = createPkg(arrPackFile, packFilePath, ret);
          }

          url = parseTmpl(templates[ resType ], { src: uri, attributes: resType === 'css' ? 'rel="stylesheet"' : '' });
          arrTmpMerge.push(url);

          if (isLayout) {
            if (mergedMap[ resId ]) {
              mergedMap[ resId ].push(fileId);
            } else {
              mergedMap[ resId ] = [ fileId ];
            }
          }
        });

      var strTmpMerge = arrTmpMerge.join('\n');

      console.log('merge res is %s', strTmpMerge);
      content = content.replace(placeholder, strTmpMerge);
    };
  });




  if (isLayout) {
    hasPackedPage[ fileId ] = true;
  }
  // console.log(content);
  file.setContent(content);
}

var pidCount = 0;
function createPkg(arrPack, packFilePath, ret) {
  var root = fis.project.getProjectPath();
  var pkg = fis.file.wrap(path.join(root, packFilePath));
  var pid = 'p' + pidCount++;
  var opt = packOpt;

  if (typeof ret.src[ pkg.subpath ] !== 'undefined') {
    fis.log.warning('there is a namesake file of package [' + subpath + ']');
  }

  var content = '';
  var has = [];
  var requires = [];
  var requireMap = {};

  arrPack.forEach(function (id) {
    console.log('------------%s',id)
    var file = ret[ 'ids' ][ id ];

    if (ret.map.res[ id ]) {
      var c = file.getContent();

      // 派送事件
      var message = {
        file: file,
        content: c,
        pkg: pkg
      };
      fis.emit('pack:file', message);
      c = message.content;

      if (c) {
        content += content ? '\n' : '';

        if (file.isJsLike) {
          content += ';';
        } else if (file.isCssLike) {
          c = c.replace(/@charset\s+(?:'[^']*'|"[^"]*"|\S*);?/gi, '');
        }

        content += '/*!' + file.subpath + '*/\n' + c;
      }

      ret.map.res[ id ].pkg = pid;
      requires = requires.concat(file.requires);
      requireMap[ id ] = true;
      has.push(id);
    }
  });

  if (has.length) {
    pkg.setContent(content);
    ret.pkg[ pkg.subpath ] = pkg;

    // collect dependencies
    var deps = [];
    requires.forEach(function (id) {
      if (!requireMap[ id ]) {
        deps.push(id);
        requireMap[ id ] = true;
      }
    });
    var pkgInfo = ret.map.pkg[ pid ] = {
      uri: pkg.getUrl(opt.hash, opt.domain),
      type: pkg.rExt.replace(/^\./, ''),
      has: has
    };
    if (deps.length) {
      pkgInfo.deps = deps;
    }
  }

  return pkg.getUrl();
}

function transformUrlToFileId(ret,arr) {
  var urlmapping = ret.urlmapping;
  var ret = [];
  arr.forEach(function (url) {
    if (urlmapping[ url ]) {
      ret.push(urlmapping[ url ].id)
    } else {
      throw new Error(url + ' is not in urlmapping');
    }
  });

  return ret;
}

// 检查一个资源被打包的layout是否是该页面依赖的layout
function isPackedInLayout(arrLayout, arrDepLayout) {
  var ret = false;
  arrLayout.forEach(function (layoutId) {
    if (arrDepLayout.indexOf(layoutId) !== -1) {
      ret = true;
      return;
    }
  });
  return ret;
}

// arrTodo 数组里面是subpath的数组
var env = 'dev';
function packAll(arrTodo, ret, settings) {
  env = settings.env || env;
  var files = ret.src;
  var packed = {};

  // arrTodo = [ '/page/layout/frame.vm', '/page/index.vm' ];
  arrTodo.forEach(function (subpath) {
    console.log(subpath);
    var file = files[ subpath ];
    packItem(ret, file.id);
  });

  console.log('layoutMap:%s', JSON.stringify(layoutMap, null, 4));
}


var packOpt;
module.exports = function (ret, pack, settings, opt) {
  var files = ret.src;
  packOpt = opt;
  // 生成url map 表
  var urlmapping = ret.urlmapping = {};
  Object.keys(files).forEach(function(subpath) {
    var file = files[subpath];
    if (file.release) {
      urlmapping[file.getUrl()] = file;
    }
  });

  // 忽略 packTo 信息，直接从 settings 中读取。
  debugger;
  // var src = ret.src;
  // var sources = [];
  // var packed = {}; // cache all packed resource.
  // var ns = fis.config.get('namespace');
  // var connector = fis.config.get('namespaceConnector', ':');
  // var root = fis.project.getProjectPath();

  var arrTodo = [];

  Object.keys(files).forEach(function (subpath) {
    var file = files[ subpath ];
    var regPagePath = /^page\/(.*?)\.vm$/;
    // 如果不是模板文件或不是在page目录下面，直接跳过
    if (!file.isHtmlLike || !regPagePath.test(file.id)) {
      return;
    }

    // console.info('push file:%s ', fileId);
    arrTodo.push(subpath);
    // var fileId = file.id;
    // var content = file.getContent();

    // var isLayout = false;
    // var regLayout = /#extends\(("|')(\/?page\/layout\/.*?)\.vm\1\s*(("|')var:tplType=("|')(.*?)\5\4)?(?:.*?)\)/;
    // var match = content.match(regLayout);
    // if (!match) {
    //   isLayout = true;
    // }


      // var conf = {
      //   // isLayout: isLayout,
      //   fileId: fileId,
      //   map: ret.map[ 'res' ]

      // };

      // content = packDeps(content, conf);



      // file.setContent(content);

  });

  // 把frame layout 添加到数组的第一位
  if (settings[ 'layout' ] && settings[ 'layout' ][ 'frame' ]) {
    arrTodo.unshift(settings[ 'layout' ][ 'frame' ]);
  }

  packAll(arrTodo, ret, settings);

};

