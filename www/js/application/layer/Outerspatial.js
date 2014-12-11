lvector.Outerspatial = lvector.GeoJSONLayer.extend({
    initialize: function(options) {
        
        // Check for required parameters
        for (var i = 0, len = this._requiredParams.length; i < len; i++) {
            if (!options[this._requiredParams[i]]) {
                throw new Error("No \"" + this._requiredParams[i] + "\" parameter found.");
            }
        }
        
        // Extend Layer
        lvector.Layer.prototype.initialize.call(this, options);
    
        // Create an array to hold the features
        this._vectors = [];
        
        
        if (this.options.map) {
            if (this.options.scaleRange && this.options.scaleRange instanceof Array && this.options.scaleRange.length === 2) {
                var z = this.options.map.getZoom();
                var sr = this.options.scaleRange;
                this.options.visibleAtScale = (z >= sr[0] && z <= sr[1]);
            }
            this._show();
        }
    },
    
    options: {
        limit: null,
        uniqueField: null,
        pageSize: null
    },
    
    _requiredParams: ["url"],
    
    _getFeatures: function() {        
        var url = this.options.url + 
            "?opentrails=true&per_page=" + this.options.pageSize;
        if (!this.options.showAll) {
            var ne = this.options.map.getBounds().getNorthEast();
            var center = this.options.map.getCenter();
            var radius = ne.distanceTo(center) * 0.000621;

            url = url +
            "&near_addr=" + center.lat.toFixed(4) + "," + center.lng.toFixed(4) +
            "&distance=" + Math.round(radius);
        }
        
        // Limit returned features
        if (this.options.limit) {
            // TODO
        }
        var _loadPage = function(self, url, page) {
            $.get(url + "&page=" + page, function(data){
                self._processFeatures(data.data);
                if(data.paging.current_page === 1 && data.paging.total_pages > 1) {
                    for(var i=2; i<=data.paging.total_pages;i++){
                        _loadPage(self,url,i);
                    }
                }
        });        
    }
        _loadPage(this,url,1);
    },
    

    
});
