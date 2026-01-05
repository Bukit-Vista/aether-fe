/* eslint-disable no-unused-vars */
const clone = require('clone'),
  xtend = require('xtend');
const source = {
  // gist: require('../source/gist'), // Removed Gist source
  local: require('../source/local')
};

function _getData() {
  return {
    map: {
      type: 'FeatureCollection',
      features: []
    },
    dirty: false,
    source: null,
    meta: null,
    type: 'local',
    mapStyleLoaded: false
  };
}

module.exports = function (context) {
  const _data = _getData();

  function mapFile(gist) {
    let f;
    let content;

    for (f in gist.files) {
      content = gist.files[f].content;
      if (f.indexOf('.geojson') !== -1 && content) {
        return f;
      }
    }

    for (f in gist.files) {
      content = gist.files[f].content;
      if (f.indexOf('.json') !== -1 && content) {
        return f;
      }
    }
  }

  const data = {};

  data.hasFeatures = function () {
    return !!(_data.map && _data.map.features && _data.map.features.length);
  };

  data.set = function (obj, src) {
    for (const k in obj) {
      _data[k] = typeof obj[k] === 'object' ? clone(obj[k], false) : obj[k];
    }
    if (obj.dirty !== false) data.dirty = true;
    context.dispatch.change({
      obj: obj,
      source: src
    });
    return data;
  };

  data.clear = function () {
    data.set(_getData());
  };

  data.mergeFeatures = function (features, src) {
    function coerceNum(feature) {
      const props = feature.properties,
        keys = Object.keys(props),
        length = keys.length;

      for (let i = 0; i < length; i++) {
        const key = keys[i];
        const value = props[key];
        feature.properties[key] = losslessNumber(value);
      }

      return feature;
    }

    function losslessNumber(x) {
      const fl = parseFloat(x);
      if (fl.toString() === x) return fl;
      else return x;
    }

    _data.map.features = (_data.map.features || []).concat(
      features.map(coerceNum)
    );
    return data.set({ map: _data.map }, src);
  };

  data.get = function (k) {
    return _data[k];
  };

  data.all = function () {
    return clone(_data, false);
  };

  data.fetch = function (q, cb) {
    const type = q.id.split(':')[0];

    switch (type) {
      // Removed Gist case
      // case 'gist': {
      //   const id = q.id.split(':')[1].split('/')[1];
      //
      //   // From: https://api.github.com/gists/dfa850f66f61ddc58bbf
      //   // Gists > 1 MB will have truncated set to true. Request
      //   // the raw URL in those cases.
      //   source.gist.load(id, context, (err, d) => {
      //     if (err) return cb(err, d);
      //
      //     const file = mapFile(d);
      //     // Test for .json or .geojson found
      //     if (typeof file === 'undefined') return cb(err, d);
      //
      //     const f = d.files[file];
      //     if (f.truncated === true) {
      //       source.gist.loadRaw(f.raw_url, context, (err, content) => {
      //         if (err) return cb(err);
      //         return cb(
      //           err,
      //           xtend(d, { file: f.filename, content: JSON.parse(content) })
      //         );
      //       });
      //     } else {
      //       return cb(
      //         err,
      //         xtend(d, { file: f.filename, content: JSON.parse(f.content) })
      //       );
      //     }
      //   });
      //
      //   break;
      // }
      // Assuming only 'local' or other non-API types remain
      default: {
        // Handle other types or provide a default behavior/error
        console.warn('Unsupported fetch type:', type);
        cb(new Error('Unsupported data source type for fetch.'));
        break;
      }
    }
  };

  data.parse = function (d) {
    let login, path;

    // Removed Gist type check: if (d.files) d.type = 'gist';
    let type = d.length ? d[d.length - 1].type : d.type;
    if (d.commit) type = 'commit';
    switch (type) {
      case 'commit': {
        data.set({
          source: d.content
        });
        break;
      }
      case 'local': {
        data.set({
          type: 'local',
          map: d.content,
          path: d.path
        });
        break;
      }
      // Removed Gist case
      // case 'gist': {
      //   login = (d.owner && d.owner.login) || 'anonymous';
      //   path = [login, d.id].join('/');
      //
      //   data.set({
      //     type: 'gist',
      //     source: d,
      //     meta: {
      //       login: login,
      //       name: d.id,
      //       id: d.id,
      //       description: d.description
      //     },
      //     map: d.content || {
      //       type: 'FeatureCollection',
      //       features: []
      //     },
      //     path: path,
      //     route: 'gist:' + path,
      //     url: 'https://gist.github.com/' + path
      //   });
      //   break;
      // }
      default: {
        // Handle unknown types if necessary
        console.warn('Unsupported parse type:', type, d);
        break;
      }
    }
  };

  return data;
};
