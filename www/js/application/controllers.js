(function (ng) {
  'use strict';

  var module = ng.module('trails.controllers', []);

  module.controller('NotificationsCtrl', [

    '$scope',
    'Models',
    'GeoPosition',

    function ($scope, Models, GeoPosition) {

      // Instantiate variables

      var index = 0; // the currently showing steward.

      // Wait until all models have been
      // loaded to instantiate variables
      var unwatchLoaded = $scope.$watch(Models.loaded, function (value) {
        if(Models.loaded()) {
          navigator.splashscreen.hide();
          $scope.stewards = Models.Steward.query.all();
          $scope.steward  = $scope.stewards[index];
          $scope.stewardDetail = Models.StewardDetail.query.where({ key: 'id', evaluator: 'equals', value: parseInt($scope.steward.get('id')) }).first();

          unwatchLoaded();
        }

      });

      // Navigate to next steward

      $scope.nextSteward = function () {
        if ( index >= $scope.stewards.length-1 )
          index = -1;
        $scope.steward = $scope.stewards[++index];
        $scope.stewardDetail = Models.StewardDetail.query.where({ key: 'id', evaluator: 'equals', value: parseInt($scope.steward.get('id')) }).first();

      };

      // Navigate to previous steward

      $scope.previousSteward = function () {
        if ( index <= 0 )
          index = $scope.stewards.length;
        $scope.steward = $scope.stewards[--index];
        $scope.stewardDetail = Models.StewardDetail.query.where({ key: 'id', evaluator: 'equals', value: parseInt($scope.steward.get('id')) }).first();
      };

      function currentStewardPosition() {
        return index+1;
      }
      $scope.currentStewardPosition = currentStewardPosition;

      // Watch current steward, and set notifications
      // when it changes
      $scope.$watch('steward', function (value) {
        if (value) {
          $scope.notifications = $scope.steward.notifications.all();
        } else {
          $scope.notifications = [];
        }
      });

      $scope.selectedNotice = null;
      $scope.selectNotice = function (notification) {
        notification.markAsRead();
        if ($scope.selectedNotice === notification)
          $scope.selectedNotice = null;
        else
          $scope.selectedNotice = notification;
      };

      // Mark notification as read when closed

      $scope.closeNotification = function (notification) {
        if (notification)
          notification.markAsDeleted();
      };

      // Immensely hackish & expensive way of tracking a
      // count of total unread notifications.
      // TODO: Refactor this to update only when the
      // closeNotification function is called.
      $scope.undeletedNotifications = function () {
        var numUndeleted = 0;
        for( var i in $scope.notifications )
        {
          if (!$scope.notifications[i].attributes.deleted) numUndeleted++;
        }
        return numUndeleted;
      };

      $scope.showOfflineLayer = function () {
        $scope.stewardDetail.getOfflineTileJson(function (tileJson) {
          $scope.$emit('showOffline', tileJson, $scope.stewardDetail.getBounds());
        });
      }

      $scope.downloadTiles = function (size) {
        var bar = document.getElementById('download-bar');
        bar.style.width = '0%';
        // force caching of trailsegments
        Models.loadModel(null, 'GeoJson', $scope.stewardDetail.get('optimized_trail_segments_url'), function(data){});
        $scope.stewardDetail.downloadTiles(size, function (progress) {
          if (progress === 100)
            $scope.$apply(function () { $scope.stewardDetail.set( {offline_tiles_status: 'loaded'} )});
          else
            bar.style.width = progress + '%';
        });
      }

      $scope.deleteTiles = function () {
        $scope.stewardDetail.deleteTiles(function (success) {
          $scope.$apply(function () {
            $scope.stewardDetail.set( {offline_tiles_status: 'empty'} );
            $scope.$emit('hideOffline');
          });
        });
      }      
      // Set geoposition for address lookup

      $scope.geoposition = GeoPosition;

      $scope.openInNativeMaps = function () {
        appAvailability.check(
            'comgooglemaps://', // URI Scheme
            function() {  // Success callback
              var urlPrefix = 'comgooglemaps://';
              window.open(urlPrefix+'?daddr='+$scope.steward.get('address'), '_system');

            },
            function() {  // Error callback
              var urlPrefix = 'https://maps.google.com';
              window.open(urlPrefix+'?daddr='+$scope.steward.get('address'), '_system');

            }
        );
      };

    }

  ]);

  module.controller('AppCtrl', [
    '$scope',
    'Map',
    'Models',
    'GeoPosition',
    'GeoPositionMarker',
    'MapTileLayer',
    'MapTrailLayer',
    'MapTrailHeadMarker',
    'MapMarkerClusterGroup',
    'TrailSearch',
    'VectorLayer',
    'OfflineMapTileLayer',

    function ($scope, Map, Models, GeoPosition, GeoPositionMarker, MapTileLayer, MapTrailLayer, MapTrailHeadMarker, MapMarkerClusterGroup, TrailSearch, VectorLayer, OfflineMapTileLayer) {

      //
      // "CONSTANTS"
      //

      // Name of the views.
      var MAP_VIEW = 'map';
      var TRAILS_VIEW = 'trails';
      var NOTIFICATION_VIEW = 'notifications-notices';

      // Default search message when no filters are selected.
      var DEFAULT_SEARCH_MESSAGE = "All Activities";

      // UI element heights used for calculating offsets.
      var FOOTER_HEIGHT = document.getElementById('footer').offsetHeight;
      var TRAIL_NAV_HEIGHT = document.getElementById('trail-nav').offsetHeight;

      // DOM elements.
      var mapContainerElm = document.getElementById('map-container');
      var trailViewElm = document.getElementById('trail-view');
      var trailDataHeaderElm = document.getElementById('trail-data-header');
      var trailAndTrailheadDataElm = document.getElementById('trail-and-trailhead-data');
      var searchResultsElm = document.querySelector("#content .search-results");
      var searchFormElm = document.getElementById('search-form');
      var searchInputElm = document.getElementById('search-input');

      //
      // VIEW LOGIC
      //

      $scope.view = MAP_VIEW;

      function toggleView (id) {
        if ($scope.view === id)
          $scope.selectedTrailHead === null ? showView(MAP_VIEW) : showView(TRAILS_VIEW);
        else
          showView(id);
      }

      $scope.toggleView = toggleView;

      function showView (id) {
        if ($scope.view !== id) {
          if ($scope.view === TRAILS_VIEW && id === MAP_VIEW)
            closeTrailView();
          $scope.view = id;
        }
      }

      $scope.showView = showView;


      // Notifications view settings
      //
      // Active tab in notifications.
      $scope.isActiveTab = function(tab) {
        return tab === $scope.view;
      };

      //
      // MAP LOGIC
      //

      Map.setView(Map.DEFAULT_CENTER, Map.DEFAULT_ZOOM);

      var positionMarker = new GeoPositionMarker({
        position: Map.getCenter(),
        options: {
          clickable: false
        }
      });

      positionMarker.addTo(Map);

      GeoPosition.set({latitude: Map.getCenter().lat,longitude: Map.getCenter().lng});

      function onGeoPositionSuccess (position) {
        positionMarker.setPosition([position.coords.latitude,position.coords.longitude]);
        GeoPosition.set({latitude: position.coords.latitude,longitude: position.coords.longitude});
        console.log('Geolocated user!');
        Map.setView( positionMarker.getPosition(), Map.DEFAULT_ZOOM );
        clearSearch();
        $scope.locationPending = false;
        $scope.$digest();
      }

      function onGeoPositionError (err) {
        console.log('Error: Could not geolocate user');
        Map.setView(Map.DEFAULT_CENTER, Map.DEFAULT_ZOOM);
        $scope.locationPending = false;
        $scope.$digest();
        // positionMarker.setPosition([position.coords.latitude,position.coords.longitude]);
        // GeoPosition.set({latitude: Map.getCenter().lat,longitude: Map.getCenter().lng});
      }

      // Wait till device is ready before watching geolocation position.
      // See http://stackoverflow.com/questions/1673579/location-permission-alert-on-iphone-with-phonegap



      function recenter () {
        // this is temporary. we reset the zoom to closer since we launched the map zoomed out for demo
        Map.DEFAULT_ZOOM = 9;
        document.addEventListener("deviceready", function(){
          console.log('Device Ready!');
          navigator.geolocation.getCurrentPosition(
            onGeoPositionSuccess,
            onGeoPositionError,
            {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0
            }
          );


        }, false);
        $scope.locationPending = true;


      }
      $scope.geoposition = GeoPosition;
      $scope.recenter = recenter;

      //
      // MAP EVENT HANDLERS (added after map loads)
      //
      function onMapClick () {
        $scope.$apply(function () {
          deselectTrailHead($scope.selectedTrailHead);
        });
      }

      // Update zoom level CSS class when map is zoomed.
      var lastZoomClass; // The last zoom level class added
      function onMapZoom () {
        var zoomClass = 'map-zoom-'+Map.getZoom();
        mapContainerElm.classList.remove(lastZoomClass);
        mapContainerElm.classList.add(zoomClass);
        lastZoomClass = zoomClass;
        // keep the selected marker on top after zooming.
        lastSelectedMarker && lastSelectedMarker.bringToFront();
      }

      //
      // MAP TILES LOGIC
      //

      var baseLayers = [];
      
      baseLayers.push(new MapTileLayer({key: 'terrain'}).addTo(Map));
      baseLayers.push(new MapTileLayer({key: 'satellite'}));

      var currentLayerIndex = 0;      
      function toggleMapTileLayer () {
        Map.removeLayer(baseLayers[currentLayerIndex]);
        currentLayerIndex = ++currentLayerIndex >= baseLayers.length ? 0 : currentLayerIndex;
        Map.addLayer(baseLayers[currentLayerIndex]);
        toggleView(TRAILS_VIEW);
      }

      $scope.toggleMapTileLayer = toggleMapTileLayer;

      //MapTileLayer
      // SEARCH LOGIC
      //

      $scope.searchResults = [];

      function search (keywords, filters) {
        $scope.lastSearch = keywords;
        $scope.searchResults = TrailSearch.perform({ keywords: keywords, filters: filters, position: GeoPosition });

        searchResultsElm.scrollTop = 0;
      }

      $scope.search = search;

      function clearSearch () {
        $scope.lastSearch = null;
        $scope.searchKeywords = null;

        // Uses a bitmap for filter values so that all filter states can be
        // stored in a single integer.
        $scope.searchFilters = {
          canFoot: 1,
          canBicycle: 2,
          canHorse: 4,
          canSki: 8,
          filterBitmap: 0,
          isFiltered: function(value)
          {
            return this.filterBitmap & this[value];
          }
        };

        $scope.searchResultsMessage = DEFAULT_SEARCH_MESSAGE;
        $scope.search();
      }

      $scope.clearSearch = clearSearch;

      function setSearchFilter (key) {
        $scope.searchFilters.filterBitmap ^= $scope.searchFilters[key];

        var bitmap = $scope.searchFilters.filterBitmap;
        var msgArray = [];
        if (bitmap & $scope.searchFilters.canFoot )
          msgArray.push("Hiking");
        if (bitmap & $scope.searchFilters.canBicycle )
          msgArray.push("Biking");
        if (bitmap & $scope.searchFilters.canHorse )
          msgArray.push("Horse Riding");
        if (bitmap & $scope.searchFilters.canSki )
          msgArray.push("XC Skiing");

        if (msgArray.length > 0)
          $scope.searchResultsMessage = msgArray.join(", ");
        else
          $scope.searchResultsMessage = DEFAULT_SEARCH_MESSAGE;

        search($scope.searchKeywords, $scope.searchFilters);
      }

      $scope.setSearchFilter = setSearchFilter;

      //
      // TRAIL LAYERS LOGIC
      //

      var trailHeadCluster = new MapMarkerClusterGroup();
      var trailHeadMarkers = [];
      var trailsLayer;

      $scope.selectedTrailHead = null;
      $scope.selectedSteward = null;
      $scope.selectedTrail = null;
      $scope.selectedPhotos = [];
      $scope.selectedTrails = [];
      $scope.carouselIndex = 0;
      $scope.appLoaded = false;
      function onLoad (loaded) {
        if (loaded) {
          $scope.appLoaded = true;
          $scope.stewards = Models.Steward.query.all();
          $scope.selectedSteward = Models.Steward.query.first();

          Models.TrailHead.query.each(_initializeTrailHeadMarker);
          trailHeadCluster.addTo(Map);

         // Models.TrailSegment.loadGeoJSON(onTrailSegmentData);
          trailsLayer = new MapTrailLayer({ }).addTo(Map);

          var vectorLayer = new VectorLayer();
          vectorLayer.setOrganizations(Models.StewardDetail.query.collection);
          vectorLayer.setGeoJsonProvider(Models.loadModel);
          vectorLayer.setMap(Map);


          // Populate search results view with all results.
          clearSearch();

          // Add initial zoom level class to map container
          lastZoomClass = 'map-zoom-'+Map.getZoom();
          mapContainerElm.classList.add(lastZoomClass);

          // Add event listeners
          Map.on('click', onMapClick);
          Map.on('zoomend', onMapZoom);
          // searchFormElm.addEventListener('submit', _searchFormSubmitted, false);
          // ^^ commented out in merge conflict resolution. - AJW
          unwatchLoaded();
        }
      }

      function _searchFormSubmitted(evt) {
        searchInputElm.blur();
      }

      // Initialize map marker and add events
      function _initializeTrailHeadMarker (t) {
        var marker = MapTrailHeadMarker.fromTrailHead(t);
        trailHeadMarkers.push(marker);
        trailHeadCluster.addLayer(marker);

        // Bind click event to marker.
        // Use closure to retrieve original marker.
        marker.delegate.on('click', function (e) {
          _onTrailHeadMarkerClick(marker);
        });
      }

      function _onTrailHeadMarkerClick (marker) {
        var record = marker.get('record');
        if ( record !== $scope.selectedTrailHead ) {
          $scope.$apply(function () { selectTrailHead( record ); });
        } else {
          $scope.$apply(function () { deselectTrailHead( record ); });
        }
      }

      function openTrailHeadInNativeMaps (trailhead) {
        var position = $scope.selectedTrailHead.getLatLng();

        appAvailability.check(
            'comgooglemaps://', // URI Scheme
            function() {  // Success callback
              var urlPrefix = 'comgooglemaps://';
              window.open(urlPrefix+'?daddr='+position.join(','), '_system');

            },
            function() {  // Error callback
              var urlPrefix = 'https://maps.google.com';
              window.open(urlPrefix+'?daddr='+position.join(','), '_system');
            }
        );
      }

      $scope.openTrailHeadInNativeMaps = openTrailHeadInNativeMaps;

      function selectTrailHead (th, t) {
        if (!th || ng.isUndefined(th)) return false;
        $scope.selectedTrailHead = th;
        $scope.selectedTrails = th.cachedTrails();
        $scope.selectedTrailHeadSteward = th.stewards.first();
        if ($scope.selectedTrails.length > 0) {
          $scope.selectedTrail = t || th.trails.first();
          $scope.selectedPhotos = $scope.selectedTrail.photos.all();
        }
        else {
          // this is the case where the trailhead has no associated trails
          $scope.selectedTrail = null;
          $scope.selectedPhotos = [];
        }

        mapContainerElm.classList.add('trail-selected');

        // #HACK -- sets height of trail view dynamically
        // based upon the height of its constituent elements.
        // Let's find a more elegant solution for this.
        // Using the present implementation setTrailViewOffset
        // needs to fire when the angular template has finished
        // rendering, so that the height of the template can be retrieve.
        // Using a timeout is suggested here:
        // http://stackoverflow.com/questions/11125078/is-there-a-post-render-callback-for-angular-js-directive
        setTimeout(setTrailViewOffset, 50);

        // Set the view to the trail view.
        // So when on the search view the view changes when a trail is clicked.
        showView(TRAILS_VIEW);
      }

      $scope.selectTrailHead = selectTrailHead;

      function deselectTrailHead (th) {
        if (!th || ng.isUndefined(th)) return false;
        $scope.selectedTrailHead = null;
        $scope.selectedTrails = [];
        $scope.selectedTrail = null;
        $scope.selectedPhotos = [];
        $scope.selectedSteward = null;

        mapContainerElm.classList.remove('trail-selected');
      }

      function selectTrail (t) {
        if (!t || ng.isUndefined(t)) return false;
        $scope.selectedTrail = t;
        $scope.selectedPhotos = t.photos.all();
      }

      $scope.selectTrail = selectTrail;

      // Remove the marker from the Marker clusters
      // and add it to the map so that it doesn't
      // combine with a cluster at zoomed out levels.
      function moveMarkerToMap(marker)
      {

        trailHeadCluster.removeLayer(marker);
        var index = trailHeadMarkers.indexOf(marker);
        if (index > -1) trailHeadMarkers.splice(index, 1);
        marker.addTo(Map);
      }

      // Add the marker to the Marker clusters
      // and remove it from the map so that it does
      // combine with a cluster at zoomed out levels.
      function moveMarkerToCluster(marker)
      {
        trailHeadMarkers.push(marker);
        marker.removeFrom(Map);
        trailHeadCluster.addLayer(marker);
      }

      var lastSelectedMarker; // The last marker that was selected
      $scope.$watch('selectedTrailHead', function (value) {

        var newMarkerSelected; // The new marker that was select, or null
        ng.forEach(trailHeadMarkers, function (marker) {

          if (marker.get('record') === value) {
            newMarkerSelected = marker;
          }

        });

        // NOTE: This scenario occurs when a marker is clicked.
        // If a new marker was selected, deselect the old marker
        // and move it to the clustering group.
        // Move the new marker to the map and select it.
        // Then register the new marker as the last selected marker.
        // Lastly, show the trails view.
        if (newMarkerSelected) {
          if (lastSelectedMarker) {
            moveMarkerToCluster(lastSelectedMarker);
            lastSelectedMarker.deselect();
          }
          moveMarkerToMap(newMarkerSelected);
          newMarkerSelected.select();
          lastSelectedMarker = newMarkerSelected;
          showView(TRAILS_VIEW);
        }
        // NOTE: This scenario occurs when the map is clicked.
        // If no new marker was selected and there is
        // a last selected marker, then move the last selected
        // marker to the cluster group and deselect it.
        // Also, set the last selected marker to null,
        // since there was no new marker clicked.
        // Lastly, show the map view.
        else if (lastSelectedMarker)
        {
          moveMarkerToCluster(lastSelectedMarker);
          lastSelectedMarker.deselect();
          lastSelectedMarker = null;
          showView(MAP_VIEW);
        }

      });

      $scope.$watch('selectedTrail', function (trail) {
        if (trail) {
          $scope.selectedPhotos = trail.photos.all();
          if (trailsLayer){
            var fitOptions = {
              paddingBottomRight: [0, 250]
            };
            trailsLayer.deselect();
            var segment_ids = trail.get('segment_ids');
            trailsLayer.select(segment_ids);
            Map.fitBounds( trailsLayer.getSelectedBounds(), fitOptions );
          }
        }
      });

      $scope.nextTrail = function () {
        var index  = $scope.selectedTrails.indexOf($scope.selectedTrail);
        if ( index >= $scope.selectedTrails.length-1 )
          index = -1;
        $scope.selectedTrail = $scope.selectedTrails[++index];
        setTimeout(setTrailViewOffset, 50);
      };

      $scope.previousTrail = function () {
        var index = $scope.selectedTrails.indexOf($scope.selectedTrail);
        if ( index <= 0 )
          index = $scope.selectedTrails.length;
        $scope.selectedTrail = $scope.selectedTrails[--index];
        setTimeout(setTrailViewOffset, 50);
      };

      $scope.hasMoreTrails = function () {
        return ($scope.selectedTrails.length <= 1);
      };

      var _fullscreen = false; // whether the trail view is in fullscreen or not.
      function toggleTrailView() {
        (!_fullscreen) ? _fullscreenOn() : _fullscreenOff();
      }

      $scope.toggleTrailView = toggleTrailView;

      // Switch fullscreen off.
      function _fullscreenOff() {
        _fullscreen = false;
        trailViewElm.classList.remove('fullscreen');
        // when leaving fullscreen mode, make sure we scroll back to the top.
        trailAndTrailheadDataElm.scrollTop = 0;
        trailAndTrailheadDataElm.addEventListener('touchmove',_touchMoveHandler);
      }

      // Switch fullscreen on.
      function _fullscreenOn() {
        trailViewElm.classList.add('fullscreen');
        trailAndTrailheadDataElm.removeEventListener('touchmove',_touchMoveHandler);
        _fullscreen = true;
      }

      // Prevent scrolling when not in fullscreen mode.
      function _touchMoveHandler(evt) {
        evt.preventDefault();
      }

      // @return [Boolean] Whether trails view is fullscreen or not.
      function isFullscreen() {
        return _fullscreen;
      }

      $scope.isFullscreen = isFullscreen;

      function closeTrailView() {
        trailViewElm.classList.add('closed');
        if (_fullscreen) {
          trailViewElm.style.webkitTransition = '-webkit-transform 1s';
          _fullscreenOff();
        }
        deselectTrailHead($scope.selectedTrailHead);
      }

      $scope.closeTrailView = closeTrailView;

      function setTrailViewOffset() {
        var trailHeaderHeight = trailDataHeaderElm.offsetHeight;
        var viewportHeight = window.innerHeight;
        var BOTTOM_PADDING = 20;
        var calcValue = viewportHeight - (FOOTER_HEIGHT+TRAIL_NAV_HEIGHT+trailHeaderHeight+BOTTOM_PADDING);
        //  annoying hack. Remove once phb fully supports the statusbar plugin.
        if(!utils.is_ios)    
            calcValue += 20;
        trailViewElm.style.webkitTransform = 'translate3d(0, '+calcValue+'px, 0)';
        trailViewElm.style.webkitTransition = '-webkit-transform 0.5s';
        trailViewElm.classList.remove('closed');
      }


      function distance(th) {
        if (th) {
          return th.distanceFrom(GeoPosition.get('latitude'), GeoPosition.get('longitude'));
        }
      }

      $scope.distance = distance;

      $scope.$on('showOffline', function (e, tileJson, bounds) { 
        Map.removeLayer(baseLayers[currentLayerIndex]);

        for (var i = 0; i < baseLayers.length; i++) {
          if ( baseLayers[i] instanceof OfflineMapTileLayer ) {
              baseLayers.splice(i, 1);            
          }
        };
        var layer = new OfflineMapTileLayer({tileJson: tileJson}); 
        Map.addLayer(layer);
        baseLayers.push(layer);
        Map.fitBounds(bounds);
        $scope.$apply(function(){$scope.view = MAP_VIEW});
      });

      $scope.$on('hideOffline', function () { 
        for (var i = 0; i < baseLayers.length; i++) {
          if ( baseLayers[i] instanceof OfflineMapTileLayer ) {
            if ( Map.hasLayer(baseLayers[i]) ) {
              Map.removeLayer(baseLayers[i]);
              Map.addLayer(baseLayers[0]);
              baseLayers.splice(i, 1);
             }
          }
        };
      });

      // On Load

      var unwatchLoaded = $scope.$watch(Models.loaded, onLoad);
    }

  ]);

})(angular);
