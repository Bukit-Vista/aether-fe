const shpwrite = require('shp-write'),
  clone = require('clone'),
  geojson2dsv = require('geojson2dsv'),
  topojson = require('topojson-server'),
  saveAs = require('file-saver'),
  tokml = require('@placemarkio/tokml'),
  geojsonNormalize = require('@mapbox/geojson-normalize'),
  wellknown = require('wellknown');

const flash = require('./flash'),
  zoomextent = require('../lib/zoomextent'),
  readFile = require('../lib/readfile');

/**
 * This module provides the file picking & status bar above the map interface.
 * It dispatches to source implementations that interface with specific
 * sources, like GitHub.
 */
module.exports = function fileBar(context) {
  const shpSupport = typeof ArrayBuffer !== 'undefined';

  const exportFormats = [
    {
      title: 'GeoJSON',
      action: downloadGeoJSON
    },
    {
      title: 'TopoJSON',
      action: downloadTopo
    },
    {
      title: 'CSV',
      action: downloadDSV
    },
    {
      title: 'KML',
      action: downloadKML
    },
    {
      title: 'WKT',
      action: downloadWKT
    }
  ];

  if (shpSupport) {
    exportFormats.push({
      title: 'Shapefile',
      action: downloadShp
    });
  }

  function bar(selection) {
    const actions = [];

    const items = selection
      .append('div')
      .attr('class', 'inline')
      .selectAll('div.item')
      .data(actions)
      .enter()
      .append('div')
      .attr('class', 'item');

    items
      .append('a')
      .attr('class', 'parent')
      .on('click', function (d) {
        if (d.action) d.action.apply(this, d);
      })
      .text((d) => {
        return ' ' + d.title;
      });

    items.each(function (d) {
      if (!d.children) return;
      d3.select(this)
        .append('div')
        .attr('class', 'children')
        .call(submenu(d.children));
    });

    function submenu(children) {
      return function (selection) {
        selection
          .selectAll('a')
          .data(children)
          .enter()
          .append('a')
          .attr('title', (d) => {
            if (
              d.title === 'File' ||
              d.title === 'GitHub' ||
              d.title === 'Gist' ||
              d.title === 'Add map layer' ||
              d.title === 'Zoom to features' ||
              d.title === 'Clear' ||
              d.title === 'Random: Points' ||
              d.title === 'Add bboxes' ||
              d.title === 'Flatten Multi Features'
            )
              return d.alt;
          })
          .text((d) => {
            return d.title;
          })
          .on('click', function (d) {
            d.action.apply(this, d);
          });
      };
    }

    function blindImport() {
      const put = d3
        .select('body')
        .append('input')
        .attr('type', 'file')
        .style('visibility', 'hidden')
        .style('position', 'absolute')
        .style('height', '0')
        .on('change', function () {
          const files = this.files;
          if (!(files && files[0])) return;
          readFile.readAsText(files[0], (err, text) => {
            readFile.readFile(files[0], text, onImport);
            if (files[0].path) {
              context.data.set({
                path: files[0].path
              });
            }
          });
          put.remove();
        });
      put.node().click();
    }

    function onImport(err, gj, warning) {
      gj = geojsonNormalize(gj);
      if (gj) {
        context.data.mergeFeatures(gj.features);
        if (warning) {
          flash(context.container, warning.message);
        } else {
          flash(
            context.container,
            'Imported ' + gj.features.length + ' features.'
          ).classed('success', 'true');
        }
        zoomextent(context);
      }
    }

    d3.select(document).call(
      d3.keybinding('file_bar').on('⌘+o', () => {
        blindImport();
        d3.event.preventDefault();
      })
    );
  }

  function downloadTopo() {
    const content = JSON.stringify(
      topojson.topology(
        {
          collection: clone(context.data.get('map'))
        },
        { 'property-transform': allProperties }
      )
    );

    saveAs(
      new Blob([content], {
        type: 'text/plain;charset=utf-8'
      }),
      'map.topojson'
    );
  }

  function downloadGeoJSON() {
    if (d3.event) d3.event.preventDefault();
    const content = JSON.stringify(context.data.get('map'));
    const meta = context.data.get('meta');
    saveAs(
      new Blob([content], {
        type: 'text/plain;charset=utf-8'
      }),
      (meta && meta.name) || 'map.geojson'
    );
  }

  function downloadDSV() {
    if (d3.event) d3.event.preventDefault();
    const content = geojson2dsv(context.data.get('map'));
    saveAs(
      new Blob([content], {
        type: 'text/plain;charset=utf-8'
      }),
      'points.csv'
    );
  }

  function downloadKML() {
    if (d3.event) d3.event.preventDefault();
    const content = tokml.toKML(context.data.get('map'));
    saveAs(
      new Blob([content], {
        type: 'text/plain;charset=utf-8'
      }),
      'map.kml'
    );
  }

  function downloadShp() {
    if (d3.event) d3.event.preventDefault();
    d3.select('.map').classed('loading', true);
    try {
      shpwrite.download(context.data.get('map'));
    } finally {
      d3.select('.map').classed('loading', false);
    }
  }

  function downloadWKT() {
    if (d3.event) d3.event.preventDefault();
    const features = context.data.get('map').features;
    if (features.length === 0) return;
    const content = features.map(wellknown.stringify).join('\n');
    saveAs(
      new Blob([content], {
        type: 'text/plain;charset=utf-8'
      }),
      'map.wkt'
    );
  }

  function allProperties(properties, key, value) {
    properties[key] = value;
    return true;
  }

  return bar;
};
