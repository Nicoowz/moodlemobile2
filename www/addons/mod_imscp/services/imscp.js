// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

angular.module('mm.addons.mod_imscp')

/**
 * IMSCP factory.
 *
 * @module mm.addons.mod_imscp
 * @ngdoc service
 * @name $mmaModImscp
 */
.factory('$mmaModImscp', function($mmFilepool, $mmSite, $mmUtil, $mmFS, $http, $log, $q, mmaModImscpComponent) {
    $log = $log.getInstance('$mmaModImscp');
    var self = {};

    /**
     * Download all the content.
     *
     * @module mm.addons.mod_imscp
     * @ngdoc method
     * @name $mmaModImscp#downloadAllContent
     * @param {Object} module The module object.
     * @return {Object}       Where keys are imscp filepaths, and values are relative local paths.
     * @protected
     */
    self.downloadAllContent = function(module) {
        var promises = [];

        angular.forEach(module.contents, function(content) {
            var url,
                fullpath;
            if (content.type !== 'file') {
                return;
            }

            fullpath = content.filename;
            if (content.filepath !== '/') {
                fullpath = content.filepath.substr(1) + fullpath;
            }

            url = self._fixUrl(content.fileurl);
            promises.push($mmFilepool.downloadUrl($mmSite.getId(), url, false, mmaModImscpComponent, module.id)
            .then(function(internalUrl) {
                return [fullpath, $mmFilepool.getFilePathByUrl($mmSite.getId(), url)];
            }));
        });

        return $q.all(promises).then(function(files) {
            var filePaths = {};
            angular.forEach(files, function(file) {
                filePaths[file[0]] = file[1];
            });
            return filePaths;
        });
    };

    /**
     * Fixes the URL before use.
     *
     * @module mm.addons.mod_imscp
     * @ngdoc method
     * @name $mmaModImscp#_fixUrl
     * @param  {String} url The URL to be fixed.
     * @return {String}     The fixed URL.
     * @protected
     */
    self._fixUrl = function(url) {
        url = $mmSite.fixPluginfileURL(url);
        return url;
    };

    /**
     * Check the status of the files.
     *
     * Return those status in order of priority:
     * - $mmFilepool.FILENOTDOWNLOADED
     * - $mmFilepool.FILEDOWNLOADING
     * - $mmFilepool.FILEOUTDATED
     * - $mmFilepool.FILEDOWNLOADED
     *
     * @module mm.addons.mod_imscp
     * @ngdoc method
     * @name $mmaModPage#getFilesStatus
     * @param {Object} module The module object returned by WS.
     * @return {Promise} Resolved with an object containing the status and a list of event to observe.
     */
    self.getFilesStatus = function(module) {
        var promises = [],
            eventNames = [],
            notDownloaded = 0,
            downloading = 0,
            outdated = 0,
            downloaded = 0,
            fileCount = 0;

        angular.forEach(module.contents, function(content) {
            var url;
            if (content.type !== 'file') {
                return;
            }
            fileCount++;
            url = self._fixUrl(content.fileurl);
            promises.push($mmFilepool.getFileStateByUrl($mmSite.getId(), url).then(function(state) {
                if (state == $mmFilepool.FILENOTDOWNLOADED) {
                    notDownloaded++;
                } else if (state == $mmFilepool.FILEDOWNLOADING) {
                    downloading++;
                    eventNames.push($mmFilepool.getFileEventNameByUrl($mmSite.getId(), url));
                } else if (state == $mmFilepool.FILEDOWNLOADED) {
                    downloaded++;
                } else if (state == $mmFilepool.FILEOUTDATED) {
                    outdated++;
                }
            }));
        });

        function prepareResult() {
            var status = $mmFilepool.FILENOTDOWNLOADED;
            if (notDownloaded > 0) {
                status = $mmFilepool.FILENOTDOWNLOADED;
            } else if (downloading > 0) {
                status = $mmFilepool.FILEDOWNLOADING;
            } else if (outdated > 0) {
                status = $mmFilepool.FILEOUTDATED;
            } else if (downloaded == fileCount) {
                status = $mmFilepool.FILEDOWNLOADED;
            }
            return {status: status, eventNames: eventNames};
        }

        return $q.all(promises).then(function() {
            return prepareResult();
        }, function() {
            return prepareResult();
        });
    };

    /**
     * Prepare the view of the module in an iframe, and returns the src.
     *
     * @module mm.addons.mod_imscp
     * @ngdoc method
     * @name $mmaModImscp#getIframeSrc
     * @param {Object} module The module object.
     * @return {Promise}
     */
    self.getIframeSrc = function(module) {
        var toc = JSON.parse(module.contents[0].content);
        var mainFile = toc[0].href;

        return self.downloadAllContent(module).then(function(filePaths) {
            return $mmUtil.getIframeSrc(filePaths, mainFilePath);
        });
    };


    /**
     * Invalidate the prefetched content.
     *
     * @module mm.addons.mod_imscp
     * @ngdoc method
     * @name $mmaModImscp#invalidateContent
     * @param {Number} moduleId The module ID.
     * @return {Promise}
     */
    self.invalidateContent = function(moduleId) {
        return $mmFilepool.invalidateFilesByComponent($mmSite.getId(), mmaModImscpComponent, moduleId);
    };

    /**
     * Report the imscp as being viewed.
     *
     * @module mm.addons.mod_imscp
     * @ngdoc method
     * @name $mmaModImscp#logView
     * @param {Number} instanceId The instance ID of the module.
     * @return {Void}
     */
    self.logView = function(instanceId) {
        if (instanceId) {
            $mmSite.write('mod_imscp_view_imscp', {
                imscpid: instanceId
            });
        }
    };

    /**
     * Prefetch the content.
     *
     * @module mm.addons.mod_imscp
     * @ngdoc method
     * @name $mmaModImscp#prefetchContent
     * @param {Object} module The module object returned by WS.
     * @return {Void}
     */
    self.prefetchContent = function(module) {
        angular.forEach(module.contents, function(content) {
            var url;
            if (content.type !== 'file') {
                return;
            }
            url = self._fixUrl(content.fileurl);
            $mmFilepool.addToQueueByUrl($mmSite.getId(), url, mmaModImscpComponent, module.id);
        });
    };

    return self;
});
