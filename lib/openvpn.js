var Promise = require('bluebird');
var telnet = require('telnet-client');
var _ = require('lodash');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var openvpnEmitter = false;
var connection = false;
var isVpnConnected = false;
var isConnectionClose  = false;

module.exports.destroy = function() {
    if (connection) {
        connection.removeAllListeners();
        connection.end();
        connection.destroy();
        connection = false;
    }
}

module.exports.connect = function(params) {
    establishConnection(params)
        .then(OpenVPNLog)
        .then(function() {
            return OpenVPNManagement('pid');
        })
        .then(function() {
            return OpenVPNManagement('bytecount 1');
        })
        .then(function() {
            return OpenVPNManagement('hold release');
        })
        .then(function() {
            openvpnEmitter.emit('connected');
        });

    return openvpnEmitter
}

module.exports.connectAndKill = function(params) {
    establishConnection(params)
        .then(OpenVPNLog)
        .then(disconnectOpenVPN);

    return openvpnEmitter;
}

module.exports.authorize = function(auth) {
    return OpenVPNManagement(util.format('username "Auth" "%s"', auth.user))
        .then(function() {
            OpenVPNManagement(util.format('password "Auth" "%s"', auth.pass));
        });
}

module.exports.disconnect = function() {
    return disconnectOpenVPN();
}

module.exports.cmd = function(cmd) {
    return OpenVPNManagement(cmd);
}

function establishConnection(params) {

    connection = new telnet();
    openvpnEmitter = new EventEmitter();

    connection.on('end', function() {
        openvpnEmitter.emit('end');
    });
    connection.on('close', function() {
        isConnectionClose = true;
        openvpnEmitter.emit('close');
    });
    connection.on('error', function(error) {
        console.error(error);
        openvpnEmitter.emit('error', error);
    });

    return new Promise(function(resolve) {
        resolve(
            connection.connect(
                _.defaults(params, {
                    host: '127.0.0.1',
                    port: 1337,
                    shellPrompt: '',
                    timeout: 2
                })
            )
        );
    });
}

function disconnectOpenVPN() {
    if(!isVpnConnected || isConnectionClose)
        return Promise.resolve();
    return OpenVPNManagement('signal SIGTERM').then(function(){
        openvpnEmitter.emit('disconnected');
    });
}

function OpenVPNManagement(cmd) {
    return new Promise(function(resolve, reject) {
        setTimeout(function() {
            if (connection) {
                connection.exec(cmd, resolve);
            }
        }, 1000);
    });
}

function OpenVPNLog() {
    connection.exec('log on all', function(logsResponse) {
        connection.exec('state on', function(logsResponse) {
            connection.on('console-output', function(response) {

              _.each(response.split("\n"), function(res) {

                if (res && res.substr(1, 5) == 'STATE') {
                    const responses = res.substr(7).split(",");
                    if(responses.length >= 3) {
                      if(responses[1] == "CONNECTED" && responses[2] == "SUCCESS") {
                        isVpnConnected = true;
                        openvpnEmitter.emit('vpn-connected');
                      }
                    }         
                    openvpnEmitter.emit('state-change', responses);
                } else if (res && res.substr(1, 4) == 'HOLD') {
                  openvpnEmitter.emit('hold-waiting');
                }else if ((res && res.substr(1, 5) == 'FATAL') || (res && res.substr(1, 5) == 'ERROR')) {
                  openvpnEmitter.emit('error', res.substr(7));
                }else if (res && res.substr(1, 9) == 'BYTECOUNT') {
                  openvpnEmitter.emit('bytecount', res.substr(11).split(","));
                }else if (res && res.substr(0, 7) == 'SUCCESS') {
                    if (res.substr(9,3) == 'pid') {
                        openvpnEmitter.emit('pid', res.substr(13));
                    }
                } else {
                  if (res.length > 0) {
                    openvpnEmitter.emit('console-output', res);
                  }
                }
              });

            });
        });
    });
}
