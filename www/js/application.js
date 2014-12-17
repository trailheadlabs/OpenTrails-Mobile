(function (ng) {
  'use strict';

  var module = ng.module('trails', [
    'trails.routes',
    'trails.controllers',
    'trails.services',
    'trails.directives',
    'angular-carousel',
    'ngTouch'
  ]);

  var onDeviceReady = function () {
    ng.bootstrap(document, ['trails']);
  };

  document.addEventListener('deviceready', onDeviceReady, false);

})(angular);