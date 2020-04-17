/*
 * Copyright (C) 2012-2016 InSeven Limited.
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */

(function ($) {
  
  App.Drive = function(callback) {
    this.init(callback);
  };

  App.Drive.State = {
    UNKNOWN: 0,
    UNAUTHORIZED: 1,
    AUTHORIZED: 2,
  };

  App.Drive.DOMAIN = "drive";

  App.Drive.Property = {
    TOKEN: 0,
    REFRESH_TOKEN: 1
  };

  App.Drive.Instance = function(callback) {
    var newInstance = true;
    if (window.drive === undefined) {
      window.drive = new App.Drive(callback);
    } else {
      newInstance = false;
    }
    return { drive: window.drive, newInstance: newInstance };
  };

  jQuery.extend(App.Drive.prototype, {
    
      init: function (callback) {
        var self = this;
        self.state = App.Drive.State.UNINITIALIZED;
        self.stateChangeCallbacks = [];
        self.logging = new App.Logging(window.config.logging_level, "drive");
        self.requestId = 0;

        self.store = new App.Store("com.gameplaycolor.drive", 50);
        self.store.open(function(opened, error) {
          if (!opened) {
            alert("Unable to create database.\nPlease accept increased storage size when asked.");
            return;
          }

          callback();
        });
      },

      onStateChange: function(callback) {
        var self = this;
        self.stateChangeCallbacks.push(callback);
      },

      setState: function(state) {
        var self = this;

        self.logging.info("setState: current = " + self.state + ", new = " + state);

        if (self.state == state) {
          return;
        }

        self.state = state;

        if (self.state == App.Drive.State.UNAUTHORIZED) {
          self.store.deleteProperty(App.Drive.DOMAIN, App.Drive.Property.TOKEN);
          self.store.deleteProperty(App.Drive.DOMAIN, App.Drive.Property.REFRESH_TOKEN);
          self.deferredAuthentication = undefined;
        }

        for (var i = 0; i < self.stateChangeCallbacks.length; i++) {
          self.stateChangeCallbacks[i](state);
        }
      },

      // Attmept to refresh the token,
      // If this action fails, the state is automatically reset to unauthorized.
      handleInvalidToken: function() {
        var self = this;
        return self.refreshToken().fail(function() {
          self.logging.info("Failed to refresh token, setting state to unauthorized");
          self.setState(App.Drive.State.UNAUTHORIZED);
        });
      },

      scheduleOperation: function(operation) {
        var self = this;
        operation();
      },

      signOut: function() {
        var self = this;

        var deferred = jQuery.Deferred();
        self.track("signOut", deferred.promise());

        deferred.promise().then(function() {
          self.setState(App.Drive.State.UNAUTHORIZED);
        });

        self.token().then(function(token) {

          deferred.resolve();

        }).fail(function(e) {
          
          deferred.reject(e);

        });

        return deferred.promise();
      },

      didLoadSDK: function() {
        var self = this;
        self.logging.info("Google Drive SDK loaded");
        self.sdk.resolve();
      },

      signIn: function() {
        var self = this;

        self.logging.info("Signing in to Google Drive");
        self.authURL().then(function(url) {

          self.logging.info("Navigating to " + url);
          window.open(url, "_blank");

        });
      },

      authURL: function() {
        var self = this;

        var deferred = jQuery.Deferred();
        self.track("authURL", deferred.promise());

        var url = 'https://localhost/o/oauth2/auth' +
                  '?redirect_uri=' + encodeURIComponent(window.config.redirect_uri) +
                  '&response_type=code' +
                  '&client_id=' + window.config.client_id +
                  '&scope=' + window.config.scopes.join(" ") +
                  '&approval_prompt=force' + // required for an access token
                  '&access_type=offline'; // required for an access token
        deferred.resolve(url);

        return deferred.promise();
      },

      user: function() {
        var self = this;

        var deferred = jQuery.Deferred();
        self.track("user", deferred.promise());

        self.token().then(function(token) {
          var user = {name:"dummy"};
          deferred.resolve(user);

        }).fail(function(e) {
          deferred.reject(e);
        });

        return deferred.promise();
      },

      nextRequestId: function() {
        var self = this;
        self.requestId++;
        return self.requestId;
      },

      log: function(requestId, message) {
        var self = this;
        self.logging.info("[" + requestId + "] " + message);
      },

      track: function(description, promise) {
        var self = this;
        var requestId = self.nextRequestId();
        self.log(requestId, description);
        promise.then(function() {
          self.log(requestId, description + " -> SUCCESS");
        }).fail(function(e) {
          self.log(requestId, description + " -> FAIL " + e);
        });
      },

      deferredProperty: function(property) {
        var self = this;
        var deferred = jQuery.Deferred();
        self.track("deferredProperty: " + property, deferred.promise());
        self.store.property(App.Drive.DOMAIN, property, function(value) {
          if (value) {
            deferred.resolve(value);
          } else {
            deferred.reject();
          }
        });
        return deferred.promise();
      },

      token: function() {
        var self = this;
        return self.deferredProperty(App.Drive.Property.TOKEN).fail(function() {
          self.setState(App.Drive.State.UNAUTHORIZED);
        });
      },

      authorize: function() {
        var self = this;

        if (self.deferredAuthentication !== undefined) {
          return self.deferredAuthentication.promise();
        }

        var deferred = jQuery.Deferred();
        self.track("authorize", deferred.promise());

        deferred.promise().then(function() {
          self.setState(App.Drive.State.AUTHORIZED);
        }).fail(function(e) {
          self.setState(App.Drive.State.UNAUTHORIZED);
        });

        self.deferredAuthentication = deferred;
        self.token().then(function(token) {
          deferred.resolve();
        }).fail(function() {
          deferred.reject();
        });

        return deferred.promise();
      },

      getParameters: function() {
        var self = this;

        var url = window.location.href;
        if (url.indexOf('?') === -1) {
          return {};
        }

        var parameters = {};
        var pairs = url.slice(url.indexOf('?') + 1).split('&');
        $.each(pairs, function(index, value) {
          var pair = value.split('=');
          parameters[pair[0]] = pair[1];
        });

        return parameters;
      },

      redeemToken: function (code, name) {
        var self = this;

        var deferred = jQuery.Deferred();
        self.track("redeemToken", deferred.promise());

        var tokenJson = { username: name, password: code }

        self.client = WebDAV.createClient("https://andyzhk.azurewebsites.net/dav/", tokenJson);

        self.client.getDirectoryContents("/").then(function (result) {
          self.store.setProperty(App.Drive.DOMAIN, App.Drive.Property.TOKEN, JSON.stringify(tokenJson));
          self.store.setProperty(App.Drive.DOMAIN, App.Drive.Property.REFRESH_TOKEN, tokenJson);

          deferred.resolve()
        }

        ).catch(function (error) {
          deferred.reject(error);
        });

        return deferred.promise();

      },

      refreshToken: function() {
        var self = this;

        if (self.refreshDeferred !== undefined) {
          return self.refreshDeferred;
        }

        var deferred = jQuery.Deferred();
        self.track("refreshToken", deferred.promise());

        self.refreshDeferred = deferred;
        deferred.promise().always(function() {
          self.refreshDeferred = undefined;
        });

        self.deferredProperty(App.Drive.Property.REFRESH_TOKEN).then(function(refreshToken) {

          deferred.resolve();

        }).fail(function() {
          deferred.reject();
        });

        return deferred.promise();
      },


      file: function(parent, title) {
        var self = this;

        var deferred = jQuery.Deferred();
        self.track("file", deferred.promise());

        self.scheduleOperation(function() {
          self.token().then(function(token) {
            $.ajax({
              url: "https://localhost/drive/v2/files",
              type: "GET",
              data: {
                'maxResults': '1',
                'q': "trashed = false and '" + parent + "' in parents and title contains '" + title.replace("'", "\\'") + "'",
                "access_token": token
              },
              success: function(result, textStatus, jqXHR) {
                if (result.items.length > 0) {
                  deferred.resolve(result.items[0]);
                } else {
                  deferred.reject();
                }
              },
              error: function(jqXHR, textStatus, error) {
                if (jqXHR.status == 401 ||
                    jqXHR.status == 403) {
                  self.handleInvalidToken().then(function() {

                    self.file(parent, title).then(function(file) {
                      deferred.resolve(file);
                    }).fail(function() {
                      deferred.reject();
                    });

                  }).fail(function() {
                    deferred.reject(error);
                  });
                } else {
                  deferred.reject(error);
                }
              }
            });
          }).fail(function(error) {
            deferred.reject(error);
          });
        });
        return deferred.promise();
      },

      files: function() {
        var self = this;

        var deferred = jQuery.Deferred();
        self.track("files", deferred.promise());

        self.scheduleOperation(function() {
          self.token().then(function(token) {
            var loginObj = JSON.parse(token);
           
            self.client=WebDAV.createClient("https://andyzhk.azurewebsites.net/dav/gameplay",loginObj);
            self.client.getDirectoryContents("/").then(function(files){
              var numberedFiles = [];
              $.each(files,function(index,file){
                file.title = file.basename;
                file.id = btoa(file.basename);
                numberedFiles.push(file);
              })

              deferred.resolve(numberedFiles);
            }).catch(function(error) {
              deferred.reject(error);
            });
            

          }).fail(function(error) {
            deferred.reject(error);
          });

        });

        return deferred.promise();
      },

      downloadFileBase64: function(file, callback) {
        var self = this;
        self.token().then(function(token) {

          if (file.downloadUrl) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', file.downloadUrl);
            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
            xhr.responseType = 'arraybuffer';
            xhr.onload = function(e) {
              if (xhr.status == 200) {
                var uInt8Array = new Uint8Array(xhr.response);
                var i = uInt8Array.length;
                var binaryString = new Array(i);
                while (i--) {
                  binaryString[i] = String.fromCharCode(uInt8Array[i]);
                }
                var data = binaryString.join('');
                var base64 = window.btoa(data);
                callback(base64);
              } else if (xhr.status == 401 ||
                         xhr.status == 403) {
                self.handleInvalidToken().then(function() {
                  self.downloadFileBase64(file, callback);
                }).fail(function() {
                  callback(null);
                });
              } else {
                callback(null);
              }
            };
            xhr.onerror = function() {
              callback(null);
            };
            xhr.send();
          } else {
            callback(null);
          }

        }).fail(function() {
          callback(null);
        });
      },

      downloadFile: function(file) {
        var self = this;

        var deferred = jQuery.Deferred();
        self.track("downloadFile", deferred.promise());

        if (file === undefined) {
          deferred.reject();
          return deferred.promise();
        }

        self.token().then(function(token) {
          file.downloadUrl = self.client.getFileDownloadLink(file.filename)
          loginObj = JSON.parse(token);
          basicAuth = btoa(loginObj.username + ":" + loginObj.password);
          if (file.downloadUrl) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', file.downloadUrl);
            xhr.setRequestHeader('Authorization', 'Basic ' + basicAuth);
            xhr.overrideMimeType('text/plain; charset=x-user-defined');
            xhr.onload = function() {
              if (xhr.status == 200) {
                deferred.resolve(xhr.responseText);
              } else if (xhr.status == 401 ||
                         xhr.status == 403) {
                self.handleInvalidToken().then(function() {

                  self.downloadFile(file).then(function(data) {
                    deferred.resolve(data);
                  }).fail(function() {
                    deferred.reject();
                  });

                }).fail(function() {
                  deferred.reject();
                });
              } else {
                deferred.reject();
              }
            };
            xhr.onerror = function() {
              deferred.reject();
            };
            xhr.send();
          } else {
            deferred.reject();
          }

        }).fail(function(e) {
          deferred.reject(e);
        });

        return deferred.promise();
      }


  });

})(jQuery);
