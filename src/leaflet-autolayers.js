document.write('<script type="text/javascript" src="../src/lib/xml2json.min.js"></script>');

L.Control.AutoLayers = L.Control.extend({
	options: {
		collapsed: true,
		position: 'topright',
		autoZIndex: true
	},
	mapConfig: {},
	mapLayers: [],
	overLays: [],
	baseMaps: [],
	selectedOverlays: [],
	zIndexBase: 1,
	selectedBasemap: null,

	countZIndexBase: function(layers) {
		for (var i = 0; i < layers.length; i++) {
			var layer = layers[i];
			if (!layer.baseLayer) {
				autoControl.zIndexBase++;
			}
		}
	},

	initialize: function(mapConfig, options) {
		L.setOptions(this, options);
		this.mapConfig = mapConfig;
		this._layers = {};
		this._lastZIndex = 0;
		this._handlingClick = false;
		var baseLayers = mapConfig.baseLayers;
		var overlays = mapConfig.overlays;
		var selectedBasemap = this.selectedBasemap = mapConfig.selectedBasemap;

		for (var i in baseLayers) {
			this._addLayer(baseLayers[i], i);
			if (i === selectedBasemap) {
				baseLayers[i].addTo(map);
			}
		}

		for (var i in overlays) {
			this._addLayer(overlays[i], i, true);
			this.overLays[i] = overlays[i];
		}
		this.fetchMapData();
	},

	onAdd: function(map) {
		this._initLayout();
		this._update();

		map
			.on('layeradd', this._onLayerChange, this)
			.on('layerremove', this._onLayerChange, this);
		this._selectOverlays();
		return this._container;
	},

	onRemove: function(map) {
		map
			.off('layeradd', this._onLayerChange, this)
			.off('layerremove', this._onLayerChange, this);
	},

	addBaseLayer: function(layer, name) {
		this._addLayer(layer, name);
		this._update();
		return this;
	},

	addOverlay: function(layer, name) {
		this._addLayer(layer, name, true);
		this._update();
		return this;
	},

	removeLayer: function(layer) {
		var id = L.stamp(layer);
		delete this._layers[id];
		this._update();
		return this;
	},

	_initLayout: function() {
		var className = 'leaflet-control-layers',
			container = this._container = L.DomUtil.create('div', className);

		//Makes this work on IE10 Touch devices by stopping it from firing a mouseout event when the touch is released
		container.setAttribute('aria-haspopup', true);

		if (!L.Browser.touch) {
			L.DomEvent
				.disableClickPropagation(container)
				.disableScrollPropagation(container);
		} else {
			L.DomEvent.on(container, 'click', L.DomEvent.stopPropagation);
		}

		var form = this._form = L.DomUtil.create('form', className + '-list');

		if (this.options.collapsed) {

			var link = this._layersLink = L.DomUtil.create('a', className + '-toggle', container);
			link.href = '#';
			link.title = 'Layers';

			if (L.Browser.touch) {
				L.DomEvent
					.on(link, 'click', L.DomEvent.stop)
					.on(link, 'click', this._expand, this);
			} else {
				L.DomEvent.on(link, 'focus', this._expand, this);
			}
			//Work around for Firefox android issue https://github.com/Leaflet/Leaflet/issues/2033
			L.DomEvent.on(form, 'click', function() {
				setTimeout(L.bind(this._onInputClick, this), 0);
			}, this);

			this._map.on('click', this._collapse, this);
			// TODO keyboard accessibility
		} else {
			this._expand();
		}

		//base layers are made here
		var baseLayersDiv = this._baseLayersDiv = L.DomUtil.create('div', 'leaflet-control-layers-tab',
			form);
		this._baseLayersTitle = L.DomUtil.create('div', 'leaflet-control-autolayers-title',
			baseLayersDiv);
		this._baseLayersTitle.innerHTML = 'Base Maps';
		this._baseLayersClose = L.DomUtil.create('span', 'leaflet-control-autolayers-close',
			baseLayersDiv);
		var baseLayersBox = this._baseLayersBox = L.DomUtil.create('div', 'map-filter', baseLayersDiv);
		var baseLayersFilter = this._baseLayersFilter = L.DomUtil.create('input',
			'map-filter-box-base', baseLayersBox);
		baseLayersFilter.setAttribute('placeholder', 'Filter Base Layer List');
		baseLayersFilter.setAttribute('autocomplete', 'off');
		this._baseLayersList = L.DomUtil.create('div', className + '-base', baseLayersDiv);
		this._separator = L.DomUtil.create('div', className + '-separator', form);

		//overlays are done here
		var overlaysLayersDiv = this._overlaysDiv = L.DomUtil.create('div',
			'leaflet-control-layers-tab', form);
		this._overlaysLayersTitle = L.DomUtil.create('div', 'leaflet-control-autolayers-title',
			overlaysLayersDiv);
		this._overlaysLayersTitle.innerHTML = 'Overlays';
		var overlaysLayersBox = this._overlaysLayersBox = L.DomUtil.create('div', 'map-filter',
			overlaysLayersDiv);
		var overlaysLayersFilter = this._overlaysLayersFilter = L.DomUtil.create('input',
			'map-filter-box-overlays', overlaysLayersBox);
		overlaysLayersFilter.setAttribute('placeholder', 'Filter Overlays List');
		overlaysLayersFilter.setAttribute('autocomplete', 'off');
		this._overlaysList = L.DomUtil.create('div', className + '-overlays', overlaysLayersDiv);
		this._separator = L.DomUtil.create('div', className + '-separator', form);

		//selected overlays are here
		var selectedLayersDiv = this._selectedDiv = L.DomUtil.create('div',
			'leaflet-control-layers-tab', form);
		this._selectedLayersTitle = L.DomUtil.create('div', 'leaflet-control-autolayers-title',
			selectedLayersDiv);
		this._selectedLayersTitle.innerHTML = 'Selected Overlay Order';
		this._selectedList = L.DomUtil.create('div', className + '-selected', selectedLayersDiv);

		container.appendChild(form);

		return this._initEvents();
	},

	_initEvents: function() {
		var self = this;
		var overlaysFilterBox = this._overlaysLayersFilter;
		var baseFilterBox = this._baseLayersFilter;

		//stop the traditional submit from occurring
		L.DomEvent.addListener(overlaysFilterBox, 'submit', function(e) {
			L.DomEvent.stopPropagation(e);
		});

		L.DomEvent.addListener(baseFilterBox, 'submit', function(e) {
			L.DomEvent.stopPropagation(e);
		});

		//now we bind the filtering to each box
		L.DomEvent.addListener(overlaysFilterBox, 'keyup', function(e) {
			var filterBoxValue = this.value.toLowerCase();
			var displayLayers = this.parentNode.parentNode.getElementsByClassName(
				'leaflet-control-layers-overlays')[0].children;
			if (filterBoxValue.length > 2) {
				for (var i = 0; i < displayLayers.length; i++) {
					if (displayLayers[i].innerText.toLowerCase().indexOf(
							filterBoxValue) > -1) {
						displayLayers[i].style.display = 'block';
					} else {
						displayLayers[i].style.display = 'none';
					}
				}
			} else {
				for (var i = 0; i < displayLayers.length; i++) {
					displayLayers[i].style.display = 'block';
				}
			}
		});

		//now the baselayers filter box
		L.DomEvent.addListener(baseFilterBox, 'keyup', function(e) {
			var filterBoxValue = this.value.toLowerCase();
			var displayLayers = this.parentNode.parentNode.getElementsByClassName(
				'leaflet-control-layers-base')[0].children;
			if (filterBoxValue.length > 2) {
				for (var i = 0; i < displayLayers.length; i++) {
					if (displayLayers[i].innerText.toLowerCase().indexOf(
							filterBoxValue) > -1) {
						displayLayers[i].style.display = 'block';
					} else {
						displayLayers[i].style.display = 'none';
					}
				}
			} else {
				for (var i = 0; i < displayLayers.length; i++) {
					displayLayers[i].style.display = 'block';
				}
			}
		});

		//open and close setup
		var titles = this._form.getElementsByClassName('leaflet-control-autolayers-title');
		for (var t = 0; t < titles.length; t++) {
			L.DomEvent.addListener(titles[t], 'click', function(e) {
				var overlayOrBase;
				if (e.currentTarget.innerText === 'Overlays') {
					overlayOrBase = 'overlays';
				}
				if (e.currentTarget.innerText === 'Base Maps') {
					overlayOrBase = 'base';
				}

				var allTabs = this.parentNode.parentNode.getElementsByClassName(
					'leaflet-control-layers-tab');
				for (var i = 0; i < allTabs.length; i++) {
					var tab = allTabs[i].getElementsByTagName('div');

					for (var m = 0; m < tab.length; m++) {
						var tabContent = tab[m];

						if (tabContent.className !== 'leaflet-control-autolayers-title') {
							tabContent.style.display = 'none';

						}
					}
				}

				var thisTab = this.parentNode.children;
				for (var i = 0; i < thisTab.length; i++) {
					thisTab[i].style.display = 'block';
					var filter = thisTab[i].getElementsByClassName('map-filter-box-' + overlayOrBase);
					if (filter.length > 0) {
						filter[0].style.display = 'block';
					}
				}

				if (e.currentTarget.innerText === 'Overlays' || e.currentTarget
					.innerText === 'Base Maps') {
					var filterBoxValue = this.parentNode.getElementsByClassName('map-filter')[0].children[0].value
						.toLowerCase();
					var displayLayers = this.parentNode.getElementsByClassName('leaflet-control-layers-' +
						overlayOrBase)[0].getElementsByTagName('label');
					if (filterBoxValue.length > 2) {
						for (var i = 0; i < displayLayers.length; i++) {
							if (displayLayers[i].innerText.toLowerCase().indexOf(
									filterBoxValue) > -1) {
								displayLayers[i].style.display = 'block';
							} else {
								displayLayers[i].style.display = 'none';
							}
						}
					}
				} else {
					//	for (var i = 0; i < displayLayers.length; i++) {
					//		displayLayers[i].style.display = 'block';
					//	}
				}
			});
		}

		//x in the corner to close
		var closeControl = this._baseLayersClose;
		L.DomEvent.addListener(closeControl, 'click', function(e) {
			this.parentNode.parentNode.parentNode.className = this.parentNode.parentNode.parentNode.className
				.replace(
					'leaflet-control-layers-expanded', '');
		});

		//fix pesky zooming, have to dynamically measure the hidden div too! Make sure you do that!
		var overlayBox = this._overlaysList;
		L.DomEvent.addListener(overlayBox, 'mousewheel', function(e) {
			var delta = e.wheelDelta || -e.detail;
			this.scrollTop += (delta < 0 ? 1 : -1) * 30;
			e.preventDefault();
		});
		var baseBox = this._baseLayersList;
		L.DomEvent.addListener(baseBox, 'mousewheel', function(e) {
			var delta = e.wheelDelta || -e.detail;
			this.scrollTop += (delta < 0 ? 1 : -1) * 30;
			e.preventDefault();
		});
		var selectedBox = this._selectedList;
		L.DomEvent.addListener(selectedBox, 'mousewheel', function(e) {
			var delta = e.wheelDelta || -e.detail;
			this.scrollTop += (delta < 0 ? 1 : -1) * 30;
			e.preventDefault();
		});

	},

	_initMaps: function() {
		var allMapLayers = this.mapLayers;
		var mapConfig = this.mapConfig;
		var self = this;
		var selected;
		for (var m = 0; m < allMapLayers.length; m++) {
			var mapLayers = allMapLayers[m];
			for (var i = 0; i < mapLayers.length; i++) {
				var mapLayer = mapLayers[i];
				if (!mapLayer.baseLayer) {
					self.zIndexBase++;
				}

				var layerOpts = {
					noWrap: mapLayer.noWrap ? mapLayer.noWrap : false,
					continuousWorld: mapConfig.continuousWorld ? mapConfig.continuousWorld : true,
					tileSize: 256,
					tms: mapLayer.tms ? mapLayer.tms : false,
					zoomOffset: mapLayer.zoomOffset ? mapLayer.zoomOffset : 0,
					minZoom: 1,
					maxZoom: mapConfig.maxZoom ? mapConfig.maxZoom : 12,
					attribution: mapLayer.attribution ? mapLayer.attribution : 'Source Currently Unknown'
				};
				var layer;
				if (mapLayer.type === 'wms') {
					layer = L.tileLayer.wms(mapLayer.url, {
						layers: mapConfig.layers,
						format: 'image/png',
						maxZoom: 16,
						transparent: true
					});
					self.baseMaps[mapLayer.name] = layer;
				} else {
					layer = new L.tileLayer(mapLayer.url, layerOpts);
				}
				if (mapLayer.baseLayer) {
					self.baseMaps[String(mapLayer.name).trim()] = layer;

				} else {
					self.overLays[String(mapLayer.name).trim()] = layer;
				}
				if (mapLayer.baseLayer && !self.selectedBasemap) {
					self.selectedBasemap = mapLayer.name.trim();
					layer.addTo(map);
				} else if (mapLayer.name === self.selectedBasemap && mapLayer.baseLayer) {
					self.selectedBasemap = mapLayer.name.trim();
					layer.addTo(map);
				}
			}
		}

		//populate what is each in the global properties
		var baseLayers = this.baseMaps;
		var overlays = this.overLays;

		for (var i in baseLayers) {
			this._addLayer(baseLayers[i], i);
		}

		for (var i in overlays) {
			this._addLayer(overlays[i], i, true);
		}

	},

	fetchMapData: function() {
		var mapServers = this.mapConfig.mapServers;
		var self = this;
		var mapLayers = [];
		for (var i = 0; i < mapServers.length; i++) {
			var layers = this.fetchMapDictionary(mapServers[i]);
			mapLayers.push(layers);
		}
		this.mapLayers = mapLayers;
		return this._initMaps();

	},

	fetchMapDictionary: function(mapServer) {
		var layers = [];
		var folders = [];
		var mapServerName = mapServer.name;
		var mapPass = -1;
		var blacklist = mapServer.blacklist;
		var whitelist = mapServer.whitelist;
		var url = mapServer.dictionary.replace(/&amp;/g, '&');
		ajax(url, function(res) {
			if (mapServer.type === 'esri') {
				var response = JSON.parse(res);
				//check to see if we have any root folder layers
				var services = response.services;
				//check to see if any folders, if none it'll be empty array
				folders = response.folders;
				for (var i = 0; i < services.length; i++) {
					if (services[i].type === 'MapServer') {
						var layerName = services[i].name;
						var layerUrl = mapServer.url + '/' + layerName +
							mapServer.tileUrl;
						var url = mapServer.url + '/' + layerName +
							'/MapServer?f=pjson';
						mapPass = -1;
						if (mapServer.baseLayers) {
							mapPass = mapServer.baseLayers.indexOf(layerName);
						}
						if ((whitelist && whitelist.indexOf(layerName) > -1) || (blacklist && blacklist.indexOf(
								layerName) === -1)) {
							if (!(mapServer.baseLayers) || mapPass > -1) {
								layers.push({
									detailsUrl: url,
									url: layerUrl,
									name: layerName,
									type: 'esri',
									baseLayer: true,
									attribution: mapServerName + ' - ' + layerName
								});
							} else {
								layers.push({
									detailsUrl: url,
									url: layerUrl,
									name: layerName,
									type: 'esri',
									baseLayer: false,
									attribution: mapServerName + ' - ' + layerName
								});
							}
						}
					}
				}
				//now we check folders, why? we don't want calls within calls
				if (folders.length > 0) {
					for (var f = 0; f < folders.length; f++) {
						var folderUrl = mapServer.url + '/' + folders[f] +
							'?f=pjson';
						ajax(folderUrl, function(res) {
							var response = JSON.parse(res);
							//check to see if we have any layers here
							var services = response.services;
							for (var i = 0; i < services.length; i++) {
								if (services[i].type === 'MapServer') {
									var fullName = services[i].name.split('/');
									var layerName = fullName[1];
									var folderName = fullName[0];
									var layerUrl = mapServer.url + '/' + folderName +
										'/' + layerName + mapServer.tileUrl;
									var url = mapServer.url + '/' + folderName +
										'/' + layerName + '/MapServer?f=pjson';
									mapPass = -1;
									if (mapServer.baseLayers) {
										mapPass = mapServer.baseLayers.indexOf(layerName);
									}
									if ((whitelist && whitelist.indexOf(layerName) > -1) || (blacklist && blacklist.indexOf(
											layerName) === -1)) {
										if (!(mapServer.baseLayers) || mapPass > -1) {
											layers.push({
												detailsUrl: url,
												url: layerUrl,
												name: layerName,
												type: 'esri',
												baseLayer: true,
												attribution: mapServerName + ' - ' +
													layerName
											});
										} else {
											layers.push({
												detailsUrl: url,
												url: layerUrl,
												name: layerName,
												type: 'esri',
												baseLayer: false,
												attribution: mapServerName + ' - ' +
													layerName
											});
										}
									}
								}
							}
						});
					}
				}
			} else if (mapServer.type === 'nrltileserver') {
				var x2js = new X2JS();
				var parser = new DOMParser();
				var xmlDoc = parser.parseFromString(res, "text/xml");
				var parsedRes = x2js.xml2json(xmlDoc);
				var capability = parsedRes.WMT_MS_Capabilities.Capability.Layer;
				var capLayers = capability.Layer;
				var contactInfo = parsedRes.WMT_MS_Capabilities.Service.ContactInformation;
				var crs = parseInt(capability.SRS.substring(5));
				for (var j = 0; j < capLayers.length; j++) {
					var layer = capLayers[j];
					var layerObj = {
						crs: crs,
						maxZoom: 18,
						name: layer.Title,
						type: 'nrl',
						zoomOffset: 2,
						tms: false,
						noWrap: false,
						continuousWorld: true,
						attribution: mapServerName + ': ' + contactInfo.ContactPersonPrimary
							.ContactOrganization + ' - ' + layer.Title,
						url: mapServer.url + '/openlayers/' + layer.Name +
							mapServer.tileUrl
					};
					mapPass = -1;
					if (mapServer.baseLayers) {
						mapPass = mapServer.baseLayers.indexOf(layer.Name);
					}
					if ((whitelist && whitelist.indexOf(layer.Name) > -1) || (blacklist && blacklist.indexOf(
							layer.Name) === -1)) {
						if (!(mapServer.baseLayers) || mapPass > -1) {
							layerObj.baseLayer = true;
							layers.push(layerObj);
						} else {
							layerObj.baseLayer = false;
							layers.push(layerObj);
						}
					}
				}
			}
		});
		return layers;
	},

	_getLayerByName: function(name) {
		var response;
		for (var key in this._layers) {
			var layer = this._layers[key];
			var layerName = layer.name;
			if (layerName == name) {
				response = layer;
				break;
			}
		}
		return response;
	},

	_addSelectedOverlay: function(name) {
		if (this.selectedOverlays.indexOf(name) === -1) {
			this.selectedOverlays.unshift(name);
			this._buildSelectedOverlays();
		}
	},

	_buildSelectedOverlays: function() {
		var self = this;
		var selectedOverlays = this.selectedOverlays;
		var container = this._selectedList;
		container.innerHTML = '';
		for (var i = 0; i < selectedOverlays.length; i++) {
			var name = selectedOverlays[i];
			var selectedLabel = L.DomUtil.create('label', 'selected-label');
			var selectedRemove = L.DomUtil.create('span', 'selected-remove', selectedLabel);
			var selectedName = L.DomUtil.create('span', 'selected-name', selectedLabel);
			selectedName.innerHTML = name;
			var selectedUp;
			var selectedDown;
			if (selectedOverlays.length === 1) {
				selectedUp = L.DomUtil.create('span', 'selected-none', selectedLabel);
				selectedDown = L.DomUtil.create('span', 'selected-none', selectedLabel);
			} else {
				if (selectedOverlays.length === (i + 1)) {
					selectedUp = L.DomUtil.create('span', 'selected-up', selectedLabel);
					selectedDown = L.DomUtil.create('span', 'selected-none', selectedLabel);
				} else if (i === 0) {
					selectedUp = L.DomUtil.create('span', 'selected-none', selectedLabel);
					selectedDown = L.DomUtil.create('span', 'selected-down', selectedLabel);
				} else {
					selectedUp = L.DomUtil.create('span', 'selected-up', selectedLabel);
					selectedDown = L.DomUtil.create('span', 'selected-down', selectedLabel);
				}
			}

			container.appendChild(selectedLabel);

			L.DomEvent.addListener(selectedRemove, 'click', function(e) {
				var name = this.parentNode.getElementsByClassName('selected-name')[0].innerHTML;
				var layer = self._getLayerByName(name);
				self._map.removeLayer(layer.layer);
			});
			//Now setup for up and down ordering
			L.DomEvent.addListener(selectedUp, 'click', function(e) {
				var name = this.parentNode.getElementsByClassName('selected-name')[0].innerHTML;
				self._upSelectedOverlay(name);
			});
			L.DomEvent.addListener(selectedDown, 'click', function(e) {
				var name = this.parentNode.getElementsByClassName('selected-name')[0].innerHTML;
				self._downSelectedOverlay(name);
			});

		}

	},

	_removeSelectedOverlay: function(name) {
		if (this.selectedOverlays.indexOf(name) > -1) {
			//var labels = this._selectedList.getElementsByTagName('label');
			//for (var i = 0; i < labels.length; i++) {
			//	var label = labels[i];
			//	var nameSpan = label.getElementsByClassName("selected-name")[0];
			//	if (nameSpan.innerHTML === name) {
			//		label.parentNode.removeChild(label);
			//	}
			//}
			this.selectedOverlays.splice(this.selectedOverlays.indexOf(name), 1);
			this._buildSelectedOverlays();
		}
	},

	_upSelectedOverlay: function(name) {
		var overlays = this.selectedOverlays;
		var selectedIndex = overlays.indexOf(name);
		var upSelectedIndex = selectedIndex - 1;
		if (upSelectedIndex > -1) {
			var tempLayer = overlays[selectedIndex];
			overlays[selectedIndex] = overlays[upSelectedIndex];
			overlays[upSelectedIndex] = tempLayer;
		}
		this.selectedOverlays = overlays;
		return this._reOrderOverlay();
	},

	_downSelectedOverlay: function(name) {
		var overlays = this.selectedOverlays;
		var selectedIndex = overlays.indexOf(name);
		var upSelectedIndex = selectedIndex;
		upSelectedIndex++;
		if (upSelectedIndex < overlays.length) {
			var tempLayer = overlays[upSelectedIndex];
			overlays[upSelectedIndex] = overlays[selectedIndex];
			overlays[selectedIndex] = tempLayer;
		}
		this.selectedOverlays = overlays;
		return this._reOrderOverlay();
	},

	_reOrderOverlay: function() {
		var self = this;
		var zIndexBase = this.zIndexBase;
		var overlays = this.selectedOverlays;
		//overlays.reverse();
		var totalSelected = overlays.length;
		var maxBase = zIndexBase + totalSelected;
		for (var i = 0; i < overlays.length; i++) {
			var layerName = overlays[i];
			var layer = self._getLayerByName(layerName).layer;
			layer.setZIndex(maxBase);
			maxBase--;
		};
		return this._buildSelectedOverlays();
	},

	_setOrderOverlay: function() {
		var zIndexBase = this.zIndexBase;
		var overlays = this.selectedOverlays;
		var maxBase = zIndexBase + overlays.length;
		for (var i = 0; i < overlays.length; i++) {
			layer.setZIndex(maxBase);
			overlays[key] = layer;
		}
		this.selectedOverlays = overlays;
	},

	_selectOverlays: function() {
		var selectedOverlays = this.mapConfig.selectedOverlays;
		var overLays = this.overLays;
		for (var i = 0; i < selectedOverlays.length; i++) {
			var overlay = selectedOverlays[i];
			if (overLays[overlay]) {
				overLays[overlay].addTo(map);
			}
		}
	},
	_addLayer: function(layer, name, overlay) {
		var id = L.stamp(layer);

		this._layers[id] = {
			layer: layer,
			name: name,
			overlay: overlay
		};

		if (this.options.autoZIndex && layer.setZIndex) {
			this._lastZIndex++;
			layer.setZIndex(this._lastZIndex);
		}
	},

	_update: function() {
		if (!this._container) {
			return;
		}

		this._baseLayersList.innerHTML = '';
		this._overlaysList.innerHTML = '';

		var baseLayersPresent = false,
			overlaysPresent = false,
			i, obj;

		for (i in this._layers) {
			obj = this._layers[i];
			this._addItem(obj);
			overlaysPresent = overlaysPresent || obj.overlay;
			baseLayersPresent = baseLayersPresent || !obj.overlay;
		}

		this._separator.style.display = overlaysPresent && baseLayersPresent ? '' : 'none';
	},

	_onLayerChange: function(e) {
		var obj = this._layers[L.stamp(e.layer)];
		var self = this;
		if (!obj) {
			return;
		}

		if (!this._handlingClick) {
			this._update();
		}

		var type = obj.overlay ?
			(e.type === 'layeradd' ? 'overlayadd' : 'overlayremove') :
			(e.type === 'layeradd' ? 'baselayerchange' : null);

		if (type) {
			this._map.fire(type, obj);
		}

		if (type === 'overlayadd') {
			this._addSelectedOverlay(obj.name);
		}

		if (type === 'overlayremove') {
			this._removeSelectedOverlay(obj.name);
		}
	},

	// IE7 bugs out if you create a radio dynamically, so you have to do it this hacky way (see http://bit.ly/PqYLBe)
	_createRadioElement: function(name, checked) {

		var radioHtml = '<input type="radio" class="leaflet-control-layers-selector" name="' + name +
			'"';
		if (checked) {
			radioHtml += ' checked="checked"';
		}
		radioHtml += '/>';

		var radioFragment = document.createElement('div');
		radioFragment.innerHTML = radioHtml;

		return radioFragment.firstChild;
	},

	_addItem: function(obj) {
		var label = document.createElement('label'),
			input,
			checked = this._map.hasLayer(obj.layer);

		if (obj.overlay) {
			input = document.createElement('input');
			input.type = 'checkbox';
			input.className = 'leaflet-control-layers-selector';
			input.defaultChecked = checked;
		} else {
			input = this._createRadioElement('leaflet-base-layers', checked);
		}

		input.layerId = L.stamp(obj.layer);

		L.DomEvent.on(input, 'click', this._onInputClick, this);

		var name = document.createElement('span');
		name.innerHTML = ' ' + obj.name;

		label.appendChild(input);
		label.appendChild(name);

		var container = obj.overlay ? this._overlaysList : this._baseLayersList;
		container.appendChild(label);

		return label;
	},

	_onInputClick: function() {
		var i, input, obj,
			inputs = this._form.getElementsByTagName('input'),
			inputsLen = inputs.length;

		this._handlingClick = true;

		for (var i = 0; i < inputsLen; i++) {
			input = inputs[i];
			obj = this._layers[input.layerId];
			if (input.type === 'checkbox' || input.type === "radio") {
				if (input.checked && !this._map.hasLayer(obj.layer)) {
					this._map.addLayer(obj.layer);

				} else if (!input.checked && this._map.hasLayer(obj.layer)) {
					this._map.removeLayer(obj.layer);
				}
			}
		}

		this._handlingClick = false;

		//this._refocusOnMap();
	},
	_expand: function() {
		L.DomUtil.addClass(this._container, 'leaflet-control-layers-expanded');
	},

	_collapse: function() {
		this._container.className = this._container.className.replace(
			' leaflet-control-layers-expanded', '');
	}
});

L.control.autolayers = function(mapConfig, options) {
	return new L.Control.AutoLayers(mapConfig, options);
};

// Simple AJAX helper (since we can't assume jQuery etc. are present)
//credit to Houston Engineering, INC www.heigeo.com
function ajax(url, callback) {
	var context = this,
		request = new XMLHttpRequest();
	request.onreadystatechange = change;
	request.open('GET', url, false);
	request.send();

	function change() {
		if (request.readyState === 4) {
			if (request.status === 200) {
				callback.call(context, request.responseText);
			} else {
				callback.call(context, "error");
			}
		}
	}
};

//Here we override the attribution control's update method to better suit multilayers
L.Control.Attribution = L.Control.Attribution.extend({
	_update: function() {
		if (!this._map) {
			return;
		}

		var attribs = [];

		for (var i in this._attributions) {
			if (this._attributions[i]) {
				attribs.push(i);
			}
		}

		var prefixAndAttribs = [];

		if (this.options.prefix) {
			prefixAndAttribs.push(this.options.prefix);
		}
		if (attribs.length) {
			prefixAndAttribs.push(attribs.join(' <br /> '));
		}

		this._container.innerHTML = prefixAndAttribs.join(' | ');
	}
});