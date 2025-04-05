const mapboxgl = require('mapbox-gl');

require('qs-hash');
const geojsonRewind = require('@mapbox/geojson-rewind');
const MapboxDraw = require('@mapbox/mapbox-gl-draw').default;
const MapboxGeocoder = require('@mapbox/mapbox-gl-geocoder');

const DrawLineString = require('../draw/linestring');
const DrawRectangle = require('../draw/rectangle');
const DrawCircle = require('../draw/circle');
const SimpleSelect = require('../draw/simple_select');
const ExtendDrawBar = require('../draw/extend_draw_bar');
const { EditControl, SaveCancelControl, TrashControl } = require('./controls');
const { geojsonToLayer, bindPopup } = require('./util');
const styles = require('./styles');
const {
  DEFAULT_STYLE,
  DEFAULT_PROJECTION,
  DEFAULT_DARK_FEATURE_COLOR,
  DEFAULT_LIGHT_FEATURE_COLOR,
  DEFAULT_SATELLITE_FEATURE_COLOR
} = require('../../constants');
const drawStyles = require('../draw/styles');

let writable = false;
let drawing = false;
let editing = false;

const dummyGeojson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [0, 0]
      }
    }
  ]
};

module.exports = function (context, readonly) {
  writable = !readonly;

  const keybinding = d3
    .keybinding('map')
    .on('⌫', () => {
      if (editing) {
        context.Draw.trash();
      }
    })
    .on('m', () => {
      if (!editing) {
        context.Draw.changeMode('draw_point');
      }
    })
    .on('l', () => {
      if (!editing) {
        context.Draw.changeMode('draw_line_string');
      }
    })
    .on('p', () => {
      if (!editing) {
        context.Draw.changeMode('draw_polygon');
      }
    })
    .on('r', () => {
      if (!editing) {
        context.Draw.changeMode('draw_rectangle');
      }
    })
    .on('c', () => {
      if (!editing) {
        context.Draw.changeMode('draw_circle');
      }
    });

  d3.select(document).call(keybinding);

  function maybeShowEditControl() {
    if (context.data.hasFeatures()) {
      d3.select('.edit-control').style('display', 'block');
    }
  }

  async function map() {
    mapboxgl.accessToken = process.env.MAPBOX_ACCESS_TOKEN;

    mapboxgl.setRTLTextPlugin(
      'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.2.3/mapbox-gl-rtl-text.js',
      null,
      true
    );

    const projection = context.storage.get('projection') || DEFAULT_PROJECTION;
    let activeStyle = context.storage.get('style') || DEFAULT_STYLE;

    if (activeStyle === 'Streets') {
      activeStyle = 'Standard';
    }

    const { style } = styles.find((d) => d.title === activeStyle);

    context.map = new mapboxgl.Map({
      container: 'map',
      style,
      center: [117.27, 0],
      zoom: 2,
      projection,
      hash: 'map'
    });

    if (writable) {
      context.map.addControl(
        new MapboxGeocoder({
          accessToken: mapboxgl.accessToken,
          mapboxgl,
          marker: true
        })
      );

      context.Draw = new MapboxDraw({
        displayControlsDefault: false,
        modes: {
          ...MapboxDraw.modes,
          simple_select: SimpleSelect,
          direct_select: MapboxDraw.modes.direct_select,
          draw_line_string: DrawLineString,
          draw_rectangle: DrawRectangle,
          draw_circle: DrawCircle
        },
        controls: {},
        styles: drawStyles
      });

      const drawControl = new ExtendDrawBar({
        draw: context.Draw,
        buttons: [
          {
            on: 'click',
            action: () => {
              drawing = true;
              context.Draw.changeMode('draw_point');
            },
            classes: ['mapbox-gl-draw_ctrl-draw-btn', 'mapbox-gl-draw_point'],
            title: 'Draw Point (m)'
          },
          {
            on: 'click',
            action: () => {
              drawing = true;
              context.Draw.changeMode('draw_line_string');
            },
            classes: ['mapbox-gl-draw_ctrl-draw-btn', 'mapbox-gl-draw_line'],
            title: 'Draw LineString (l)'
          },
          {
            on: 'click',
            action: () => {
              drawing = true;
              context.Draw.changeMode('draw_polygon');
            },
            classes: ['mapbox-gl-draw_ctrl-draw-btn', 'mapbox-gl-draw_polygon'],
            title: 'Draw Polygon (p)'
          },
          {
            on: 'click',
            action: () => {
              drawing = true;
              context.Draw.changeMode('draw_rectangle');
            },
            classes: [
              'mapbox-gl-draw_ctrl-draw-btn',
              'mapbox-gl-draw_rectangle'
            ],
            title: 'Draw Rectangular Polygon (r)'
          },
          {
            on: 'click',
            action: () => {
              drawing = true;
              context.Draw.changeMode('draw_circle');
            },
            classes: ['mapbox-gl-draw_ctrl-draw-btn', 'mapbox-gl-draw_circle'],
            title: 'Draw Circular Polygon (c)'
          }
        ]
      });

      context.map.addControl(new mapboxgl.NavigationControl());

      context.map.addControl(drawControl, 'top-right');

      const editControl = new EditControl();
      context.map.addControl(editControl, 'top-right');

      const saveCancelControl = new SaveCancelControl();

      context.map.addControl(saveCancelControl, 'top-right');

      const trashControl = new TrashControl();

      context.map.addControl(trashControl, 'top-right');

      const exitEditMode = () => {
        editing = false;
        context.map.setLayoutProperty('map-data-fill', 'visibility', 'visible');
        context.map.setLayoutProperty(
          'map-data-fill-outline',
          'visibility',
          'visible'
        );
        context.map.setLayoutProperty('map-data-line', 'visibility', 'visible');

        d3.selectAll('.mapboxgl-marker').style('display', 'block');

        context.Draw.changeMode('simple_select');
        context.Draw.deleteAll();

        d3.select('.save-cancel-control').style('display', 'none');
        d3.select('.trash-control').style('display', 'none');

        maybeShowEditControl();
        d3.select('.mapboxgl-ctrl-group:nth-child(3)').style(
          'display',
          'block'
        );
      };

      d3.selectAll('.mapboxgl-draw-actions-btn').on('click', function () {
        const target = d3.select(this);
        const isSaveButton = target.classed('mapboxgl-draw-actions-btn_save');
        if (isSaveButton) {
          const FC = context.Draw.getAll();
          context.data.set(
            {
              map: {
                ...FC,
                features: stripIds(FC.features)
              }
            },
            'map'
          );
        }

        exitEditMode();
      });

      d3.select('.mapbox-gl-draw_trash').on('click', () => {
        context.Draw.trash();
      });

      d3.selectAll('.mapbox-gl-draw_edit').on('click', () => {
        editing = true;
        d3.select('.edit-control').style('display', 'none');
        d3.select('.mapboxgl-ctrl-group:nth-child(3)').style('display', 'none');

        d3.select('.save-cancel-control').style('display', 'block');
        d3.select('.trash-control').style('display', 'block');

        context.map.setLayoutProperty('map-data-fill', 'visibility', 'none');
        context.map.setLayoutProperty(
          'map-data-fill-outline',
          'visibility',
          'none'
        );
        context.map.setLayoutProperty('map-data-line', 'visibility', 'none');

        d3.selectAll('.mapboxgl-marker').style('display', 'none');

        const featureIds = context.Draw.add(context.data.get('map'));
        context.Draw.changeMode('simple_select', {
          featureIds
        });
      });
    }

    context.map.on('idle', () => {
      if (
        context.data.get('mapStyleLoaded') &&
        !context.map.getSource('map-data')
      ) {
        const { name } = context.map.getStyle();

        let color = DEFAULT_DARK_FEATURE_COLOR;

        if (['Mapbox Dark'].includes(name)) {
          color = DEFAULT_LIGHT_FEATURE_COLOR;
        }

        if (['Mapbox Satellite Streets'].includes(name)) {
          color = DEFAULT_SATELLITE_FEATURE_COLOR;
        }

        if (['Mapbox Light', 'Mapbox Dark', 'osm'].includes(name)) {
          context.map.setFog({
            range: [0.5, 10],
            color: '#ffffff',
            'high-color': '#245cdf',
            'space-color': [
              'interpolate',
              ['linear'],
              ['zoom'],
              4,
              '#010b19',
              7,
              '#367ab9'
            ],
            'horizon-blend': [
              'interpolate',
              ['exponential', 1.2],
              ['zoom'],
              5,
              0.02,
              7,
              0.08
            ],
            'star-intensity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              5,
              0.35,
              6,
              0
            ]
          });
        }

        context.map.addSource('map-data', {
          type: 'geojson',
          data: dummyGeojson
        });

        context.map.addLayer({
          id: 'map-data-fill',
          type: 'fill',
          source: 'map-data',
          paint: {
            'fill-color': ['coalesce', ['get', 'fill'], color],
            'fill-opacity': ['coalesce', ['get', 'fill-opacity'], 0.3]
          },
          filter: ['==', ['geometry-type'], 'Polygon']
        });

        context.map.addLayer({
          id: 'map-data-fill-outline',
          type: 'line',
          source: 'map-data',
          paint: {
            'line-color': ['coalesce', ['get', 'stroke'], color],
            'line-width': ['coalesce', ['get', 'stroke-width'], 2],
            'line-opacity': ['coalesce', ['get', 'stroke-opacity'], 1]
          },
          filter: ['==', ['geometry-type'], 'Polygon']
        });

        context.map.addLayer({
          id: 'map-data-line',
          type: 'line',
          source: 'map-data',
          paint: {
            'line-color': ['coalesce', ['get', 'stroke'], color],
            'line-width': ['coalesce', ['get', 'stroke-width'], 2],
            'line-opacity': ['coalesce', ['get', 'stroke-opacity'], 1]
          },
          filter: ['==', ['geometry-type'], 'LineString']
        });

        geojsonToLayer(context, writable);

        context.data.set({
          mapStyleLoaded: false
        });
      }
    });

    context.map.on('zoomend', () => {
      const zoom = context.map.getZoom();
      if (zoom < 6) {
        d3.select('.projection-switch').style('opacity', 1);
      } else {
        d3.select('.projection-switch').style('opacity', 0);
      }
    });

    const maybeSetCursorToPointer = () => {
      if (context.Draw.getMode() === 'simple_select') {
        context.map.getCanvas().style.cursor = 'pointer';
      }
    };

    const maybeResetCursor = () => {
      if (context.Draw.getMode() === 'simple_select') {
        context.map.getCanvas().style.removeProperty('cursor');
      }
    };

    const handleLinestringOrPolygonClick = (e) => {
      const el = e.originalEvent.target;
      if (el.nodeName !== 'CANVAS') return;
      if (drawing) return;

      bindPopup(e, context, writable);
    };

    const getPolygonCoordinates = (longitude, latitude) => {
      const offset = 0.0003;
      return [
        [
          [longitude - offset, latitude - offset],
          [longitude + offset, latitude - offset],
          [longitude + offset, latitude + offset],
          [longitude - offset, latitude + offset],
          [longitude - offset, latitude - offset]
        ]
      ];
    };

    const loadingBar = document.createElement('div');
    loadingBar.className = 'loading-bar';
    loadingBar.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(-100%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 24px;
      border-radius: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 9999;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    `;

    const spinner = document.createElement('div');
    spinner.style.cssText = `
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: white;
      animation: spin 0.8s linear infinite;
    `;

    const loadingText = document.createElement('span');
    loadingText.textContent = 'Loading data...';
    loadingText.style.cssText = `
      color: white;
      font-weight: 500;
    `;

    const loadingStyle = document.createElement('style');
    loadingStyle.textContent = `
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(loadingStyle);

    loadingBar.appendChild(spinner);
    loadingBar.appendChild(loadingText);
    document.body.appendChild(loadingBar);

    const showLoading = () => {
      loadingBar.style.transform = 'translateX(-50%) translateY(0)';
      loadingBar.style.opacity = '1';
    };

    const hideLoading = () => {
      loadingBar.style.transform = 'translateX(-50%) translateY(-100%)';
      loadingBar.style.opacity = '0';
    };

    const airbnbDataStorage = {
      listings: [],
      renderedIds: new Set(),
      geojsonData: {
        type: 'FeatureCollection',
        features: []
      }
    };

    // eslint-disable-next-line no-unused-vars
    async function getAirbnbData(lat = null, lng = null, offset = 0) {
      try {
        showLoading();

        const response = await fetch(
          `${process.env.API_BASE_URL}/database-service/queries?fn=execute_query`,
          {
            method: 'POST',
            headers: {
              'user-id': process.env.USER_ID,
              token: process.env.API_TOKEN,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              database: 'data_warehouse',
              payload: {
                table: 'airbnb_listings',
                attributes: [
                  'CAST(id AS CHAR) AS id',
                  'listing_name',
                  'area_name',
                  'roomTypeCategory',
                  'reviewsCount',
                  'bedroom',
                  'bed',
                  'review',
                  'latitude',
                  'longitude',
                  'rate',
                  'shortest_beach_distance_km',
                  `6371 * 2 * ASIN(SQRT(POWER(SIN((latitude - ${lat}) * PI() / 180 / 2), 2) + COS(latitude * PI() / 180) * COS(${lat} * PI() / 180) * POWER(SIN((longitude - ${lng}) * PI() / 180 / 2), 2))) AS distance_km`
                ],
                associations: [],
                filters: [],
                order_by: 'distance_km ASC',
                limit: 5000,
                offset: offset * 5000
              }
            })
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        console.log(
          `Fetched data for offset ${offset}:`,
          (data.data && data.data.length) || 0,
          'records'
        );
        return data.data || [];
      } catch (error) {
        console.error('Error:', error);
        return [];
      } finally {
        if (offset === 5) {
          hideLoading();
        }
      }
    }

    async function getAllAirbnbData(lat = null, lng = null) {
      if (airbnbDataStorage.geojsonData.features.length > 0) {
        setup3DChart(airbnbDataStorage.geojsonData);
      } else {
        setup3DChart(airbnbDataStorage.geojsonData);
      }

      for (let offset = 0; offset <= 5; offset++) {
        const data = await getAirbnbData(lat, lng, offset);

        const newListings = data.filter(
          (listing) => !airbnbDataStorage.renderedIds.has(listing.id)
        );

        if (newListings.length > 0) {
          console.log(`Rendering ${newListings.length} new listings`);

          const newFeatures = newListings.map((listing) => {
            airbnbDataStorage.renderedIds.add(listing.id);

            return {
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: getPolygonCoordinates(
                  listing.longitude,
                  listing.latitude
                )
              },
              properties: {
                listing_name: listing.listing_name,
                airbnbUrl: `https://www.airbnb.com/rooms/${listing.id.toString()}`,
                height: listing.reviewsCount,
                area_name: listing.area_name,
                roomTypeCategory: listing.roomTypeCategory,
                rate: listing.rate,
                review: listing.review,
                reviewsCount: listing.reviewsCount
              }
            };
          });

          airbnbDataStorage.geojsonData.features = [
            ...airbnbDataStorage.geojsonData.features,
            ...newFeatures
          ];

          setup3DChart(airbnbDataStorage.geojsonData);
        } else {
          console.log(`No new listings to render for offset ${offset}`);
        }
      }

      return airbnbDataStorage.geojsonData.features;
    }

    await getAllAirbnbData(
      context.map.getCenter().lat,
      context.map.getCenter().lng
    );

    function setup3DChart(data) {
      if (!context.map.loaded()) {
        context.map.on('load', () => setup3DChart(data));
        return;
      }

      if (context.map.getSource('3d-chart-data')) {
        context.map.getSource('3d-chart-data').setData(data);
        return;
      }

      context.map.addSource('3d-chart-data', {
        type: 'geojson',
        data: data
      });

      context.map.addLayer({
        id: '3d-chart-layer',
        type: 'fill-extrusion',
        source: '3d-chart-data',
        paint: {
          'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['get', 'review'],
            4,
            '#ff0000',
            4.5,
            '#ffa500',
            5,
            '#008000'
          ],
          'fill-extrusion-height': [
            'coalesce',
            ['*', ['get', 'reviewsCount'], 10],
            1
          ],
          'fill-extrusion-opacity': 0.8,
          'fill-extrusion-vertical-gradient': true
        }
      });
    }

    context.map.on('load', () => {
      context.data.set({
        mapStyleLoaded: true
      });
      context.map.on('mouseenter', 'map-data-fill', maybeSetCursorToPointer);
      context.map.on('mouseleave', 'map-data-fill', maybeResetCursor);
      context.map.on('mouseenter', 'map-data-line', maybeSetCursorToPointer);
      context.map.on('mouseleave', 'map-data-line', maybeResetCursor);

      context.map.on('click', 'map-data-fill', handleLinestringOrPolygonClick);
      context.map.on('click', 'map-data-line', handleLinestringOrPolygonClick);
      context.map.on(
        'touchstart',
        'map-data-fill',
        handleLinestringOrPolygonClick
      );
      context.map.on(
        'touchstart',
        'map-data-line',
        handleLinestringOrPolygonClick
      );
    });

    const tooltip = document.createElement('div');
    tooltip.className = 'map-tooltip';
    tooltip.style.position = 'absolute';
    tooltip.style.backgroundColor = 'white';
    tooltip.style.color = 'black';
    tooltip.style.padding = '15px';
    tooltip.style.borderRadius = '10px';
    tooltip.style.display = 'none';
    tooltip.style.maxWidth = '250px';
    tooltip.style.wordWrap = 'break-word';
    tooltip.style.boxShadow = '0px 4px 6px rgba(0, 0, 0, 0.1)';
    tooltip.style.fontFamily = 'Arial, sans-serif';
    document.body.appendChild(tooltip);

    let hoveredFeatureId = null;

    context.map.on('mousemove', '3d-chart-layer', (e) => {
      const features = context.map.queryRenderedFeatures(e.point, {
        layers: ['3d-chart-layer']
      });

      if (features.length > 0) {
        const feature = features[0];
        if (hoveredFeatureId !== feature.id) {
          tooltip.style.display = 'none';

          hoveredFeatureId = feature.id;

          const listingName = feature.properties.listing_name;
          const rating = feature.properties.review || 0;
          const totalReview = feature.properties.reviewsCount || 0;
          const price = feature.properties.rate;
          const propertyType = feature.properties.property_type;
          const areaName = feature.properties.area_name;

          tooltip.innerHTML = `
        <div style="font-size: 16px; font-weight: bold; color: #333;">${listingName}</div>
        <div style="font-size: 14px; color: #555;">⭐ Rating: ${rating} (${totalReview} reviews)</div>
        <div style="font-size: 14px; color: #555;">💰 Price: $${price}/night</div>
        <div style="font-size: 14px; color: #555;">🏡 Type: ${propertyType}</div>
        <div style="font-size: 14px; color: #555;">📍 Area: ${areaName}</div>
      `;

          tooltip.style.display = 'block';

          const tooltipWidth = tooltip.offsetWidth;
          const tooltipHeight = tooltip.offsetHeight;
          let tooltipX = e.originalEvent.pageX + 10;
          let tooltipY = e.originalEvent.pageY + 10;

          if (tooltipX + tooltipWidth > window.innerWidth) {
            tooltipX = window.innerWidth - tooltipWidth - 10;
          }
          if (tooltipY + tooltipHeight > window.innerHeight) {
            tooltipY = window.innerHeight - tooltipHeight - 10;
          }

          tooltip.style.left = `${tooltipX}px`;
          tooltip.style.top = `${tooltipY}px`;
        }
      } else {
        tooltip.style.display = 'none';
        hoveredFeatureId = null;
      }
    });

    context.map.on('mouseleave', '3d-chart-layer', () => {
      tooltip.style.display = 'none';
      hoveredFeatureId = null;
    });

    context.map.on('click', '3d-chart-layer', (e) => {
      const features = context.map.queryRenderedFeatures(e.point, {
        layers: ['3d-chart-layer']
      });

      if (features.length > 0) {
        const feature = features[0];
        const airbnbUrl = feature.properties.airbnbUrl;

        if (airbnbUrl) {
          window.open(airbnbUrl, '_blank');
          console.log('airbnbUrl', airbnbUrl);
        }
      }
    });

    context.map.on('style.load', () => {
      // Only add the source and layer if they don't already exist
      if (!context.map.getSource('3d-chart-data')) {
        context.map.addSource('3d-chart-data', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: []
          }
        });

        context.map.addLayer({
          id: '3d-chart-layer',
          type: 'fill-extrusion',
          source: '3d-chart-data',
          paint: {
            'fill-extrusion-color': [
              'interpolate',
              ['linear'],
              ['get', 'review'],
              4,
              '#ff0000',
              4.5,
              '#ffa500',
              5,
              '#008000'
            ],
            'fill-extrusion-height': [
              'coalesce',
              ['*', ['get', 'reviewsCount'], 10],
              1
            ],
            'fill-extrusion-opacity': 0.8,
            'fill-extrusion-vertical-gradient': true
          }
        });
      }
    });

    context.map.on('draw.create', created);

    function stripIds(features) {
      return features.map((feature) => {
        delete feature.id;
        return feature;
      });
    }

    function created(e) {
      context.Draw.deleteAll();
      update(stripIds(e.features));

      setTimeout(() => {
        drawing = false;
      }, 500);
    }

    function update(features) {
      let FC = context.data.get('map');

      FC.features = [...FC.features, ...features];

      FC = geojsonRewind(FC);

      context.data.set({ map: FC }, 'map');
    }

    context.dispatch.on('change.map', ({ obj }) => {
      maybeShowEditControl();
      if (obj.map) {
        geojsonToLayer(context, writable);
      }
    });

    context.map.on('moveend', async () => {
      const zoom = context.map.getZoom();
      const center = context.map.getCenter();
      const bounds = context.map.getBounds();

      console.log(
        `Map moved to: zoom=${zoom.toFixed(2)}, ` +
          `viewport: SW(${bounds._sw.lat.toFixed(4)}, ${bounds._sw.lng.toFixed(
            4
          )}) ` +
          `NE(${bounds._ne.lat.toFixed(4)}, ${bounds._ne.lng.toFixed(4)})`
      );

      await getAllAirbnbData(center.lat, center.lng);

      console.log(
        `Total listings displayed: ${airbnbDataStorage.geojsonData.features.length}`
      );
    });
  }

  return map;
};
