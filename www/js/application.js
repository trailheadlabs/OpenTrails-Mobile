(function (ng, fc) {
  'use strict';

  var module = ng.module('trails', [
    'trails.routes',
    'trails.controllers',
    'trails.services',
    'trails.directives'
  ]);

  var onDeviceReady = function () {
    ng.bootstrap(document, ['trails']);
  };

  document.addEventListener('deviceready', onDeviceReady, false);

  window.addEventListener('load', function() {
    fc.attach(document.body);
  }, false);

  //  This is very evil. But unfortunately it must be until Phonegap Build fully supports 
  //  the status bar plugin.
  var iOS = ( navigator.userAgent.match(/(iPad|iPhone|iPod)/g) ? true : false );
  if (!iOS) {
    document.getElementById('status').style.display = 'none';
  }

})(angular, FastClick);