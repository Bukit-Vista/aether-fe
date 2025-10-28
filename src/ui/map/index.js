/* eslint-disable no-unused-vars */
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

    const airbnbDataStorage = {
      listings: [],
      renderedIds: new Set(),
      geojsonData: {
        type: 'FeatureCollection',
        features: []
      },
      memoryCache: {},
      cache: {
        compressData: function (data) {
          try {
            // Optimize: reduce redundant parseFloat + toFixed operations
            const dataLength = data.length;
            const compressed = new Array(dataLength);
            
            for (let i = 0; i < dataLength; i++) {
              const item = data[i];
              compressed[i] = {
              id: item.id,
                longitude: Math.round(item.longitude * 100000) / 100000,
                latitude: Math.round(item.latitude * 100000) / 100000,
              listing_name: item.listing_name,
              reviewsCount: item.reviewsCount || 0,
              area_name: item.area_name || '',
              roomTypeCategory: item.roomTypeCategory || '',
              rate: item.rate || 0,
                review: Math.round((item.review || 0) * 10) / 10,
                accuracy: Math.round((item.accuracy || 0) * 10) / 10,
                checkin: Math.round((item.checkin || 0) * 10) / 10,
                cleanliness: Math.round((item.cleanliness || 0) * 10) / 10,
                communication: Math.round((item.communication || 0) * 10) / 10,
                location: Math.round((item.location || 0) * 10) / 10,
                value: Math.round((item.value || 0) * 10) / 10
              };
            }
            
            return compressed;
          } catch (error) {
            console.warn('Failed to compress data:', error);
            return data;
          }
        },

        clearSpaceIfNeeded: function () {
          try {
            const dataKeys = Object.keys(localStorage).filter(
              (key) =>
                key.startsWith('airbnb_data_') && !key.endsWith('_timestamp')
            );

            if (dataKeys.length > 10) {
              dataKeys.sort((a, b) => {
                const timestampA = parseInt(
                  localStorage.getItem(a + '_timestamp') || '0'
                );
                const timestampB = parseInt(
                  localStorage.getItem(b + '_timestamp') || '0'
                );
                return timestampA - timestampB;
              });

              const keysToRemove = dataKeys.slice(0, dataKeys.length - 5);
              keysToRemove.forEach((key) => {
                localStorage.removeItem(key);
                localStorage.removeItem(key + '_timestamp');
                console.log('Removed old cache entry:', key);
              });
            }
          } catch (error) {
            console.warn('Failed to clear space:', error);
          }
        },

        saveToCache: function (key, data) {
          airbnbDataStorage.memoryCache[key] = {
            data: data,
            timestamp: Date.now()
          };
        },

        emergencyCacheClear: function () {
          try {
            Object.keys(localStorage).forEach((key) => {
              if (key.startsWith('airbnb_data_')) {
                localStorage.removeItem(key);
              }
            });
            console.log('Emergency cache clear performed');
          } catch (error) {
            console.error('Failed emergency cache clear:', error);
          }
        },

        getFromCache: function (key) {
          if (
            airbnbDataStorage.memoryCache[key] &&
            airbnbDataStorage.memoryCache[key].data
          ) {
            console.log(`Using in-memory cache for ${key}`);
            return airbnbDataStorage.memoryCache[key].data;
          }

          try {
            const cachedData = localStorage.getItem('airbnb_data_' + key);
            if (cachedData) {
              const parsedData = JSON.parse(cachedData);
              airbnbDataStorage.memoryCache[key] = {
                data: parsedData,
                timestamp: parseInt(
                  localStorage.getItem('airbnb_data_' + key + '_timestamp') ||
                    Date.now()
                )
              };
              return parsedData;
            }
          } catch (error) {
            console.warn('Failed to retrieve from localStorage:', error);
            try {
              localStorage.removeItem('airbnb_data_' + key);
              localStorage.removeItem('airbnb_data_' + key + '_timestamp');
            } catch (e) {
              console.log('Failed to remove corrupted cache entry', e);
            }
          }
          return null;
        },
        isCacheValid: function (key, maxAgeMs = 3600000) {
          if (
            airbnbDataStorage.memoryCache[key] &&
            airbnbDataStorage.memoryCache[key].timestamp
          ) {
            const age =
              Date.now() - airbnbDataStorage.memoryCache[key].timestamp;
            return age < maxAgeMs;
          }

          try {
            const timestamp = localStorage.getItem(
              'airbnb_data_' + key + '_timestamp'
            );
            if (timestamp) {
              const age = Date.now() - parseInt(timestamp);
              return age < maxAgeMs;
            }
          } catch (error) {
            console.warn('Failed to check cache validity:', error);
          }
          return false;
        },
        clearExpiredCache: function () {
          try {
            const now = Date.now();
            const maxAgeMs = 24 * 3600000; // 24 hours
            
            // Clear expired memory cache
            const memCacheKeys = Object.keys(airbnbDataStorage.memoryCache);
            for (let i = 0; i < memCacheKeys.length; i++) {
              const key = memCacheKeys[i];
              const entry = airbnbDataStorage.memoryCache[key];
              if (entry.timestamp && now - entry.timestamp > maxAgeMs) {
                delete airbnbDataStorage.memoryCache[key];
              }
            }

            // Clear expired localStorage cache
            const localStorageKeys = Object.keys(localStorage);
            for (let i = 0; i < localStorageKeys.length; i++) {
              const key = localStorageKeys[i];
              if (key.startsWith('airbnb_data_') && key.endsWith('_timestamp')) {
                const timestamp = parseInt(localStorage.getItem(key));
                if (now - timestamp > maxAgeMs) {
                  const dataKey = key.slice(0, -10); // Remove '_timestamp' suffix
                  localStorage.removeItem(dataKey);
                  localStorage.removeItem(key);
                }
              }
            }
          } catch (error) {
            console.warn('Failed to clear expired cache:', error);
          }
        }
      }
    };

    airbnbDataStorage.cache.clearExpiredCache();

    context.map = new mapboxgl.Map({
      container: 'map',
      style,
      center: [117.27, 0],
      zoom: 2,
      projection,
      hash: 'map',
      attributionControl: false
    });

    const bvLogoContainer = document.createElement('div');
    bvLogoContainer.className = 'bv-logo-container';
    const bvLogo = document.createElement('img');
    bvLogo.src = '/img/bv-logo.png';
    bvLogo.alt = 'Bukit Vista Logo';
    bvLogoContainer.appendChild(bvLogo);
    document.getElementById('map').appendChild(bvLogoContainer);

    let offsetValue = 0.0003;

    // Memoization cache for polygon coordinates to avoid redundant calculations
    const polygonCache = new Map();
    const POLYGON_CACHE_MAX_SIZE = 10000;

    const getPolygonCoordinates = (longitude, latitude) => {
      // Create cache key with current offset
      const cacheKey = `${longitude}_${latitude}_${offsetValue}`;
      
      // Check cache first
      if (polygonCache.has(cacheKey)) {
        return polygonCache.get(cacheKey);
      }
      
      const coordinates = [
        [
          [longitude - offsetValue, latitude - offsetValue],
          [longitude + offsetValue, latitude - offsetValue],
          [longitude + offsetValue, latitude + offsetValue],
          [longitude - offsetValue, latitude + offsetValue],
          [longitude - offsetValue, latitude - offsetValue]
        ]
      ];
      
      // Cache management: clear if too large
      if (polygonCache.size >= POLYGON_CACHE_MAX_SIZE) {
        polygonCache.clear();
      }
      
      polygonCache.set(cacheKey, coordinates);
      return coordinates;
    };

    const metricFilterContainer = document.createElement('div');
    metricFilterContainer.className = 'metric-filter-container';
    metricFilterContainer.style.cssText = `
      position: absolute;
      top: 70%;
      right: 0;
      transform: translateY(-50%);
      background: white;
      padding: 16px;
      border-radius: 12px 0 0 12px;
      box-shadow: -2px 0 15px rgba(0,0,0,0.1);
      z-index: 1;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;

    const titleContainer = document.createElement('div');
    titleContainer.style.cssText = `
      margin-bottom: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-weight: 600;
      font-size: 14px;
      color: #333;
    `;
    titleContainer.textContent = 'Filter Metrics';

    const toggleButton = document.createElement('button');
    toggleButton.className = 'metric-filter-toggle';
    toggleButton.innerHTML = '▶';
    toggleButton.style.cssText = `
      position: absolute;
      left: -32px;
      top: 50%;
      transform: translateY(-50%);
      background: white;
      border: none;
      border-radius: 8px 0 0 8px;
      padding: 8px 12px;
      cursor: pointer;
      box-shadow: -2px 0 10px rgba(0,0,0,0.1);
      transition: all 0.2s ease;
      font-size: 14px;
      color: #666;
      &:hover {
        background: #f5f5f5;
      }
    `;

    let isOpen = false;
    metricFilterContainer.style.transform = 'translateY(-50%) translateX(100%)';
    toggleButton.innerHTML = '▶';

    toggleButton.addEventListener('click', () => {
      isOpen = !isOpen;
      metricFilterContainer.style.transform = isOpen
        ? 'translateY(-50%)'
        : 'translateY(-50%) translateX(100%)';
      toggleButton.innerHTML = isOpen ? '◀' : '▶';
    });

    const metricSelect = document.createElement('select');
    metricSelect.style.cssText = `
      width: 180px;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid #e0e0e0;
      font-size: 14px;
      cursor: pointer;
      background: #f8f8f8;
      color: #333;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      transition: all 0.2s ease;
      outline: none;
      &:hover {
        border-color: #ccc;
        background: #f2f2f2;
      }
      &:focus {
        border-color: #2196F3;
        box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.1);
      }
    `;

    const options = [
      { value: 'review', label: 'Overall Rating' },
      { value: 'accuracy', label: 'Accuracy' },
      { value: 'checkin', label: 'Checkin' },
      { value: 'cleanliness', label: 'Cleanliness' },
      { value: 'communication', label: 'Communication' },
      { value: 'location', label: 'Location' },
      { value: 'value', label: 'Value' }
    ];

    options.forEach((option) => {
      const optionElement = document.createElement('option');
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      optionElement.style.cssText = `
        padding: 8px;
      `;
      metricSelect.appendChild(optionElement);
    });

    metricFilterContainer.appendChild(toggleButton);
    metricFilterContainer.appendChild(titleContainer);
    metricFilterContainer.appendChild(metricSelect);
    document.getElementById('map').appendChild(metricFilterContainer);

    let currentMetric = 'review';
    let reviewsCountMode = 'current'; // default mode
    let currentFetchController = null; // Track ongoing fetch operations
    let isFetching = false; // Track if currently fetching
    let moveendDebounceTimer = null; // Debounce timer for map movement
    let minRating = 0; // Minimum rating filter
    let maxRating = 5; // Maximum rating filter
    let ratingFilterDebounceTimer = null; // Debounce timer for rating filter

    metricSelect.addEventListener('change', (e) => {
      currentMetric = e.target.value;
      if (airbnbDataStorage.geojsonData.features.length > 0) {
        updateChartColors();
        applyRatingFilter();
      }
    });

    // Review Count Mode Filter
    const reviewModeContainer = document.createElement('div');
    reviewModeContainer.style.cssText = `
      margin-top: 12px;
      border-top: 1px solid #e0e0e0;
      padding-top: 12px;
      width: 100%;
    `;

    const reviewModeTitle = document.createElement('div');
    reviewModeTitle.style.cssText = `
      margin-bottom: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-weight: 600;
      font-size: 13px;
      color: #333;
    `;
    reviewModeTitle.textContent = 'Review Count Mode';

    const reviewModeSelect = document.createElement('select');
    reviewModeSelect.style.cssText = `
      width: 180px;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid #e0e0e0;
      font-size: 14px;
      cursor: pointer;
      background: #f8f8f8;
      color: #333;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      transition: all 0.2s ease;
      outline: none;
      &:hover {
        border-color: #ccc;
        background: #f2f2f2;
      }
      &:focus {
        border-color: #2196F3;
        box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.1);
      }
    `;

    const reviewModeOptions = [
      { value: 'current', label: 'October 2025 Dataset' },
      { value: 'previous', label: 'May 2025 Dataset' },
      { value: 'difference', label: 'Review Difference' }
    ];

    reviewModeOptions.forEach((option) => {
      const optionElement = document.createElement('option');
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      optionElement.style.cssText = `
        padding: 8px;
      `;
      reviewModeSelect.appendChild(optionElement);
    });

    reviewModeSelect.addEventListener('change', async (e) => {
      const newMode = e.target.value;
      
      // Abort any ongoing fetch operations
      if (currentFetchController) {
        currentFetchController.abort();
        console.log('Aborted previous fetch operation');
      }
      
      // Update mode
      reviewsCountMode = newMode;
      
      // Clear existing data
      airbnbDataStorage.geojsonData.features = [];
      airbnbDataStorage.renderedIds.clear();
      
      // Clear the 3D chart layer immediately to prevent mixing old data
      if (context.map.getSource('3d-chart-data')) {
        context.map.getSource('3d-chart-data').setData({
          type: 'FeatureCollection',
          features: []
        });
      }
      
      // Add small delay to ensure cleanup completes
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Only proceed if mode hasn't changed again during delay
      if (reviewsCountMode === newMode) {
      // Reload data with new mode
      await getAllAirbnbData(
        context.map.getCenter().lat,
        context.map.getCenter().lng
      );
      }
    });

    reviewModeContainer.appendChild(reviewModeTitle);
    reviewModeContainer.appendChild(reviewModeSelect);
    metricFilterContainer.appendChild(reviewModeContainer);

    // Rating Range Filter
    const ratingRangeContainer = document.createElement('div');
    ratingRangeContainer.style.cssText = `
      margin-top: 12px;
      border-top: 1px solid #e0e0e0;
      padding-top: 12px;
      width: 100%;
    `;

    const ratingRangeTitle = document.createElement('div');
    ratingRangeTitle.style.cssText = `
      margin-bottom: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-weight: 600;
      font-size: 13px;
      color: #333;
    `;
    ratingRangeTitle.textContent = 'Rating Range';

    const ratingInputsContainer = document.createElement('div');
    ratingInputsContainer.style.cssText = `
      display: flex;
      gap: 12px;
      align-items: center;
    `;

    // Min Rating Input
    const minRatingContainer = document.createElement('div');
    minRatingContainer.style.cssText = `
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    `;

    const minRatingLabel = document.createElement('label');
    minRatingLabel.textContent = 'Min';
    minRatingLabel.style.cssText = `
      font-size: 12px;
      font-weight: 500;
      color: #666;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const minRatingInput = document.createElement('input');
    minRatingInput.type = 'number';
    minRatingInput.min = '0';
    minRatingInput.max = '5';
    minRatingInput.step = '0.1';
    minRatingInput.value = '0';
    minRatingInput.style.cssText = `
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid #e0e0e0;
      font-size: 14px;
      background: #f8f8f8;
      color: #333;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      transition: all 0.2s ease;
      outline: none;
      width: 100%;
      &:hover {
        border-color: #ccc;
        background: #f2f2f2;
      }
      &:focus {
        border-color: #2196F3;
        background: white;
        box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.1);
      }
    `;

    // Max Rating Input
    const maxRatingContainer = document.createElement('div');
    maxRatingContainer.style.cssText = `
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    `;

    const maxRatingLabel = document.createElement('label');
    maxRatingLabel.textContent = 'Max';
    maxRatingLabel.style.cssText = `
      font-size: 12px;
      font-weight: 500;
      color: #666;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const maxRatingInput = document.createElement('input');
    maxRatingInput.type = 'number';
    maxRatingInput.min = '0';
    maxRatingInput.max = '5';
    maxRatingInput.step = '0.1';
    maxRatingInput.value = '5';
    maxRatingInput.style.cssText = `
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid #e0e0e0;
      font-size: 14px;
      background: #f8f8f8;
      color: #333;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      transition: all 0.2s ease;
      outline: none;
      width: 100%;
      &:hover {
        border-color: #ccc;
        background: #f2f2f2;
      }
      &:focus {
        border-color: #2196F3;
        background: white;
        box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.1);
      }
    `;

    // Add event listeners for rating filter
    const handleRatingFilterChange = () => {
      if (ratingFilterDebounceTimer) {
        clearTimeout(ratingFilterDebounceTimer);
      }

      ratingFilterDebounceTimer = setTimeout(() => {
        const minVal = parseFloat(minRatingInput.value);
        const maxVal = parseFloat(maxRatingInput.value);

        // Validate inputs
        if (minVal > maxVal) {
          minRatingInput.value = maxVal;
          minRating = maxVal;
        } else {
          minRating = minVal;
        }

        if (maxVal < minVal) {
          maxRatingInput.value = minVal;
          maxRating = minVal;
        } else {
          maxRating = maxVal;
        }

        // Ensure values are within bounds
        minRating = Math.max(0, Math.min(5, minRating));
        maxRating = Math.max(0, Math.min(5, maxRating));

        minRatingInput.value = minRating;
        maxRatingInput.value = maxRating;

        applyRatingFilter();
      }, 300); // 300ms debounce for smooth input
    };

    minRatingInput.addEventListener('input', handleRatingFilterChange);
    maxRatingInput.addEventListener('input', handleRatingFilterChange);

    // Assemble min rating container
    minRatingContainer.appendChild(minRatingLabel);
    minRatingContainer.appendChild(minRatingInput);

    // Assemble max rating container
    maxRatingContainer.appendChild(maxRatingLabel);
    maxRatingContainer.appendChild(maxRatingInput);

    // Assemble inputs container
    ratingInputsContainer.appendChild(minRatingContainer);
    ratingInputsContainer.appendChild(maxRatingContainer);

    // Assemble rating range container
    ratingRangeContainer.appendChild(ratingRangeTitle);
    ratingRangeContainer.appendChild(ratingInputsContainer);
    metricFilterContainer.appendChild(ratingRangeContainer);

    const sliderContainer = document.createElement('div');
    sliderContainer.style.cssText = `
      margin-top: 12px;
      border-top: 1px solid #e0e0e0;
      padding-top: 12px;
      width: 100%;
    `;

    const sliderLabel = document.createElement('label');
    sliderLabel.style.cssText = `
      display: block;
      margin-bottom: 5px;
      font-size: 13px;
      color: #333;
      font-weight: 500;
    `;

    const getPolygonSizeLabel = (value) => {
      if (value === 0) {
        return 'Polygon Size: None';
      } else if (value < 0.0003) {
        return 'Polygon Size: Thin';
      } else if (value === 0.0003) {
        return 'Polygon Size: Default';
      } else if (value > 0.0003 && value <= 0.0006) {
        return 'Polygon Size: Bold';
      } else {
        return 'Polygon Size: Extra Bold';
      }
    };

    sliderLabel.textContent = getPolygonSizeLabel(offsetValue);

    const offsetSlider = document.createElement('input');
    offsetSlider.type = 'range';
    offsetSlider.min = '0.000';
    offsetSlider.max = '0.001';
    offsetSlider.step = '0.0001';
    offsetSlider.value = offsetValue;
    offsetSlider.style.cssText = `
      width: 100%;
      margin: 5px 0;
    `;

    let sliderDebounceTimer = null;
    
    offsetSlider.addEventListener('input', (e) => {
      offsetValue = parseFloat(e.target.value);
      sliderLabel.textContent = getPolygonSizeLabel(offsetValue);
      
      // Clear polygon cache when offset changes
      polygonCache.clear();

      // Debounce polygon size updates for better performance
      if (sliderDebounceTimer) {
        clearTimeout(sliderDebounceTimer);
      }

      sliderDebounceTimer = setTimeout(() => {
        if (airbnbDataStorage.geojsonData.features.length > 0) {
          const featuresLength = airbnbDataStorage.geojsonData.features.length;
          
          // Optimize: directly modify features instead of creating new array
          for (let i = 0; i < featuresLength; i++) {
            const feature = airbnbDataStorage.geojsonData.features[i];
            const coordinates = feature.geometry.coordinates[0];
            
            if (coordinates && coordinates.length > 0) {
              // Optimized center calculation
              let sumLng = 0;
              let sumLat = 0;
              const coordLength = coordinates.length;
              
              for (let j = 0; j < coordLength; j++) {
                sumLng += coordinates[j][0];
                sumLat += coordinates[j][1];
              }
              
              const centerLng = sumLng / coordLength;
              const centerLat = sumLat / coordLength;

              feature.geometry.coordinates = getPolygonCoordinates(
                centerLng,
                centerLat
              );
            }
          }

          if (context.map.getSource('3d-chart-data')) {
            context.map
              .getSource('3d-chart-data')
              .setData(getFilteredGeojson());
          }
        }
      }, 100); // 100ms debounce for smooth slider interaction
    });

    sliderContainer.appendChild(sliderLabel);
    sliderContainer.appendChild(offsetSlider);
    metricFilterContainer.appendChild(sliderContainer);

    function updateChartColors() {
      if (context.map.getLayer('3d-chart-layer')) {
        context.map.setPaintProperty('3d-chart-layer', 'fill-extrusion-color', [
          'interpolate',
          ['linear'],
          ['get', currentMetric],
          4,
          '#ff0000',
          4.5,
          '#ffa500',
          5,
          '#008000'
        ]);
      }
    }

    // Helper function to get filtered geojson - ALWAYS use this instead of raw data
    function getFilteredGeojson() {
      if (!airbnbDataStorage.geojsonData.features || airbnbDataStorage.geojsonData.features.length === 0) {
        return {
          type: 'FeatureCollection',
          features: []
        };
      }

      // Filter features based on current metric and rating range
      const allFeatures = airbnbDataStorage.geojsonData.features;
      
      // If no filter is applied (default values), return all features for better performance
      if (minRating === 0 && maxRating === 5) {
        return airbnbDataStorage.geojsonData;
      }
      
      const filteredFeatures = allFeatures.filter(feature => {
        const rating = feature.properties[currentMetric];
        // Handle null/undefined ratings
        if (rating === null || rating === undefined) return false;
        return rating >= minRating && rating <= maxRating;
      });

      return {
        type: 'FeatureCollection',
        features: filteredFeatures
      };
    }

    function applyRatingFilter() {
      // Update the map with filtered data
      if (context.map.getSource('3d-chart-data')) {
        context.map.getSource('3d-chart-data').setData(getFilteredGeojson());
      }
    }

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

    async function getAirbnbData(lat = null, lng = null, skip_index = 0, modeAtFetchStart = null) {
      try {
        showLoading();

        const baseSkip = 5000;
        const skip = skip_index * baseSkip;
        const limit = 5000;

        const precision = 2;
        // Optimize cache key generation - avoid conditional checks in template
        const latKey = lat ? lat.toFixed(precision) : 'null';
        const lngKey = lng ? lng.toFixed(precision) : 'null';
        const cacheKey = `${latKey}_${lngKey}_${skip_index}_${reviewsCountMode}`;

        if (airbnbDataStorage.cache.isCacheValid(cacheKey)) {
          const cachedData = airbnbDataStorage.cache.getFromCache(cacheKey);
          if (cachedData && cachedData.length > 0) {
            console.log(`Using cached data for ${cacheKey}`);
            // Validate mode hasn't changed
            if (modeAtFetchStart && reviewsCountMode !== modeAtFetchStart) {
              console.log(`Mode changed from ${modeAtFetchStart} to ${reviewsCountMode}, discarding cached data`);
              return [];
            }
            return cachedData;
          }
        }

        let url = `${process.env.API_BASE_URL}/airbnb-listings?limit=${limit}&lat=${lat}&lng=${lng}&skip=${skip}`;
        
        // Add reviews_count_mode parameter if not current (default)
        if (reviewsCountMode !== 'current') {
          url += `&reviews_count_mode=${reviewsCountMode}`;
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          signal: currentFetchController?.signal
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        // Validate mode hasn't changed before saving/returning data
        if (modeAtFetchStart && reviewsCountMode !== modeAtFetchStart) {
          console.log(`Mode changed from ${modeAtFetchStart} to ${reviewsCountMode}, discarding fetched data`);
          return [];
        }

        if (data && data.length > 0) {
          airbnbDataStorage.cache.saveToCache(cacheKey, data);
        }

        return data || [];
      } catch (error) {
        if (error.name === 'AbortError') {
          console.log('Fetch aborted due to mode change');
          return [];
        }
        console.error('Error:', error);
        return [];
      } finally {
        if (skip_index === 5) {
          hideLoading();
        }
      }
    }

    async function getAllAirbnbData(lat = null, lng = null) {
      // Create new AbortController for this fetch operation
      currentFetchController = new AbortController();
      const modeAtStart = reviewsCountMode; // Capture mode at start of fetch
      isFetching = true;
      
      // Always ensure we start with clean data structure
      // Setup chart with current data (could be empty when switching modes)
        setup3DChart(getFilteredGeojson());

      let hasNewData = false;

      try {
      for (let skip_index = 0; skip_index <= 5; skip_index++) {
          // Check if mode changed before each batch
          if (reviewsCountMode !== modeAtStart) {
            console.log(`Mode changed during fetch, stopping data load`);
            isFetching = false;
            return [];
          }
          
          const data = await getAirbnbData(lat, lng, skip_index, modeAtStart);

        if (!data || data.length === 0) {
          continue;
        }

          // Double check mode hasn't changed after fetch completes
          if (reviewsCountMode !== modeAtStart) {
            console.log(`Mode changed after fetch, discarding data`);
            isFetching = false;
            return [];
          }

        const newListings = data.filter(
          (listing) => !airbnbDataStorage.renderedIds.has(listing.id)
        );

        if (newListings.length > 0) {
          hasNewData = true;

          const batchSize = 500;
            const featuresArray = airbnbDataStorage.geojsonData.features;
            let shouldUpdateChart = false;
            
          for (let i = 0; i < newListings.length; i += batchSize) {
              // Check mode before processing each batch
              if (reviewsCountMode !== modeAtStart) {
                console.log(`Mode changed during batch processing, stopping`);
                isFetching = false;
                return [];
              }
              
            const batch = newListings.slice(i, i + batchSize);
              const batchLength = batch.length;

              // Pre-allocate and directly push for better performance
              for (let j = 0; j < batchLength; j++) {
                const listing = batch[j];
              airbnbDataStorage.renderedIds.add(listing.id);

                featuresArray.push({
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
                    airbnbUrl: `https://www.airbnb.com/rooms/${listing.id}`,
                  height: listing.reviewsCount,
                  area_name: listing.area_name,
                  roomTypeCategory: listing.roomTypeCategory,
                  rate: listing.rate,
                  review: listing.review,
                  accuracy: listing.accuracy,
                  checkin: listing.checkin,
                  cleanliness: listing.cleanliness,
                  communication: listing.communication,
                  location: listing.location,
                  value: listing.value,
                  reviewsCount: listing.reviewsCount
                }
                });
              }

              // Only update chart for intermediate batches, not every time
            if (i + batchSize < newListings.length) {
              setup3DChart(getFilteredGeojson());
              await new Promise((resolve) => setTimeout(resolve, 0));
              } else {
                shouldUpdateChart = true;
            }
          }

            // Final update after all batches processed
            if (shouldUpdateChart) {
          setup3DChart(getFilteredGeojson());
        }
          }
        }
      } catch (error) {
        console.error('Error in getAllAirbnbData:', error);
      } finally {
        isFetching = false;
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
            [
              '*',
              [
                'case',
                ['<', ['get', 'reviewsCount'], 0],
                ['*', ['get', 'reviewsCount'], -1], // Use absolute value for negative numbers
                ['get', 'reviewsCount']
              ],
              10
            ],
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
    tooltip.style.maxWidth = '275px';
    tooltip.style.boxSizing = 'border-box';
    tooltip.style.wordWrap = 'break-word';
    tooltip.style.boxShadow = '0px 4px 6px rgba(0, 0, 0, 0.1)';
    tooltip.style.fontFamily = 'Arial, sans-serif';
    document.body.appendChild(tooltip);

    let hoveredFeatureId = null;

    context.map.on('style.load', () => {
      if (!context.map.getSource('3d-chart-data')) {
        context.map.addSource('3d-chart-data', {
          type: 'geojson',
          data: getFilteredGeojson()
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
              [
                '*',
                [
                  'case',
                  ['<', ['get', 'reviewsCount'], 0],
                  ['*', ['get', 'reviewsCount'], -1], // Use absolute value for negative numbers
                  ['get', 'reviewsCount']
                ],
                10
              ],
              1
            ],
            'fill-extrusion-opacity': 0.8,
            'fill-extrusion-vertical-gradient': true
          }
        });

        context.map.on('mousemove', '3d-chart-layer', handleChartMouseMove);
        context.map.on('mouseleave', '3d-chart-layer', handleChartMouseLeave);
        context.map.on('click', '3d-chart-layer', handleChartClick);
      }
    });

    function handleChartMouseMove(e) {
      const features = context.map.queryRenderedFeatures(e.point, {
        layers: ['3d-chart-layer']
      });

      if (features.length > 0) {
        const feature = features[0];
        if (hoveredFeatureId !== feature.id) {
          tooltip.style.display = 'none';

          hoveredFeatureId = feature.id;

          const listingName = feature.properties.listing_name;
          const totalReview = feature.properties.reviewsCount || 0;
          const price = feature.properties.rate;
          const propertyType = feature.properties.roomTypeCategory;
          const areaName = feature.properties.area_name;
          const selectedRating = feature.properties[currentMetric] || 0;

          const metricOption = options.find(
            (opt) => opt.value === currentMetric
          );
          const metricLabel = metricOption ? metricOption.label : currentMetric;

          const reviewModeOption = reviewModeOptions.find(
            (opt) => opt.value === reviewsCountMode
          );
          const reviewModeLabel = reviewModeOption ? reviewModeOption.label : reviewsCountMode;
          
          const reviewCountLabel = reviewsCountMode === 'difference' 
            ? `${totalReview > 0 ? '+' : ''}${totalReview} reviews`
            : `${totalReview} reviews`;

          tooltip.innerHTML = `
            <div style="font-size: 16px; font-weight: bold; color: #333; margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px; overflow-wrap: break-word;">
              ${listingName}
            </div>
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px; font-size: 14px; color: #555;">
              
              <div style="display: contents;">
                <div style="font-weight: 500; display: flex; align-items: center; gap: 4px;">⭐ ${metricLabel}</div>
                <div style="white-space: nowrap;">${selectedRating.toFixed(1)}</div>
              </div>
              
              <div style="display: contents;">
                <div style="font-weight: 500; display: flex; align-items: center; gap: 4px;">📊 Reviews</div>
                <div style="white-space: nowrap;">${reviewCountLabel}</div>
              </div>

              <div style="display: contents;">
                <div style="font-weight: 500; display: flex; align-items: center; gap: 4px;">📈 Mode</div>
                <div style="white-space: nowrap; font-size: 12px; background: #e3f2fd; padding: 2px 8px; border-radius: 4px; color: #1976d2;">${reviewModeLabel}</div>
              </div>
              
              <div style="display: contents;">
                <div style="font-weight: 500; display: flex; align-items: center; gap: 4px;">💰 Price</div>
                <div>$${price}/night</div>
              </div>
              
              <div style="display: contents;">
                <div style="font-weight: 500; display: flex; align-items: center; gap: 4px;">🏡 Type</div>
                <div>${propertyType}</div>
              </div>
              
              <div style="display: contents;">
                <div style="font-weight: 500; display: flex; align-items: center; gap: 4px;">📍 Area</div>
                <div>${areaName}</div>
              </div>

            </div>
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
          tooltip.style.width = 'fit-content';
          tooltip.style.padding = '16px';
        }
      } else {
        tooltip.style.display = 'none';
        hoveredFeatureId = null;
      }
    }

    function handleChartMouseLeave() {
      tooltip.style.display = 'none';
      hoveredFeatureId = null;
    }

    function handleChartClick(e) {
      const features = context.map.queryRenderedFeatures(e.point, {
        layers: ['3d-chart-layer']
      });

      if (features.length > 0) {
        const feature = features[0];
        const airbnbUrl = feature.properties.airbnbUrl;

        if (airbnbUrl) {
          window.open(airbnbUrl, '_blank');
        }
      }
    }

    context.map.off('mousemove', '3d-chart-layer');
    context.map.off('mouseleave', '3d-chart-layer');
    context.map.off('click', '3d-chart-layer');

    context.map.on('mousemove', '3d-chart-layer', handleChartMouseMove);
    context.map.on('mouseleave', '3d-chart-layer', handleChartMouseLeave);
    context.map.on('click', '3d-chart-layer', handleChartClick);

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

    context.map.on('moveend', () => {
      // Debounce map movement to prevent excessive data fetching
      if (moveendDebounceTimer) {
        clearTimeout(moveendDebounceTimer);
      }
      
      moveendDebounceTimer = setTimeout(async () => {
      const zoom = context.map.getZoom();
      const center = context.map.getCenter();

      if (zoom > 10) {
          // Abort any ongoing fetch before starting new one
          if (currentFetchController && isFetching) {
            currentFetchController.abort();
            console.log('Aborted fetch due to map movement');
          }
          
          isFetching = true;
        await getAllAirbnbData(center.lat, center.lng);
          isFetching = false;
      } else {
        console.log('Zoom level too low for data fetching:', zoom);
      }
      }, 300); // 300ms debounce delay
    });
  }

  return map;
};
