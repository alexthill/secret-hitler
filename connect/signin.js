var Utils = require.main.require('./tools/utils');
var DB = require.main.require('./tools/db');

var Lobby = require('./lobby');
var Player = require.main.require('./play/player');

var authenticate = function(socket, uid, auth) {
	DB.fetch('name, email', 'users', 'id = $1 AND auth_key = $2', [uid, auth], function(response) {
		if (response) {
			DB.query('UPDATE users SET online_at = '+Utils.seconds()+', online_count = online_count + 1 WHERE id = '+uid, null);
			socket.authed = true;
			var player = Player.allPlayers[uid];
			if (!player) {
				player = new Player(socket, uid, response.name);
			}
			socket.player = player;
			socket.emit('auth', response);

			Lobby(socket);
		} else {
			socket.emit('auth', {invalid: true});
		}
	});
}

module.exports = function(socket, uid, auth) {
	if (uid && auth) {
		authenticate(socket, uid, auth);
	}

	var returnForSignin = 'id, auth_key';

	socket.on('signin', function(data, callback) {
		authenticate(socket, data.uid, data.auth);
	});

	socket.on('signin email', function(data, callback) {
		var now = Utils.seconds();
		var email = data.email;
		DB.fetch('id, name, email, auth_key, passcode, passcode_time', 'users', 'email = $1', [email], function(userData) {
			if (userData) {
				var key = userData.passcode;
				if (key && now - userData.passcode_time > 60) {
					key = null;
				}
				if (!key) {
					key = Utils.code();
					key = '111111'; //TODO testing
					DB.update('users', 'id = '+userData.id, {passcode: key, passcode_time: now}, null, function() {
						console.log('Set signin key', userData.name, key);
						// Email.sendPasskey(userData.name, userData.email, key);
					});
				}
				callback({signin: true, email: email});
			} else {
				callback({register: true, email: email});
			}
		});
	});

	socket.on('signin passkey', function(data, callback) {
		var email = data.email;
		var passkey = data.pass;
		DB.fetch('id, name, auth_key', 'users', 'email = $1 AND passcode = $2', [email, passkey], function(userData) {
			if (userData) {
				var now = Utils.seconds();
				if (now - userData.passcode_time > 1800) {
					callback({error: 'Passkey expired. Please redo the process for a new key and try again.'});
				} else {
					DB.update('users', 'id = '+userData.id, {passcode: null}, returnForSignin, function(response) {
						console.log('Passkey confirmed', response);
						authenticate(socket, response.id, response.auth_key);
						callback(response);
					});
				}
			} else {
				callback({error: 'Passkey incorrect. Please try again.'});
			}
		});
	});

	socket.on('signin name', function(data, callback) {
		var username = data.name;
		var invalidStarts = ['guest', 'admin', 'mod'];
		for (var idx in invalidStarts) {
			var check = invalidStarts[idx];
			if (username.indexOf(check) === 0) {
				callback({error: 'Your username may not start with "'+check+'". Please try again.'});
				return;
			}
		}

		var email = data.email;
		var replace = data.replace;
		DB.fetch('id, name', 'users', 'name = $1 OR email = $2', [username, email], function(userData) {
			if (userData) {
				callback({error: 'This ' + (userData.name == username ? 'username' : 'email') + ' has already been taken. Please try again.'});
			} else {
				var authKey = Utils.uid() + Utils.uid();
				var userBegin = {name: username, email: email, auth_key: authKey};
				var insertCallback = function(response) {
					authenticate(socket, response.id, response.auth_key);
					callback(response);
				}
				if (replace) {
					DB.update('users', 'id = '+userData.id, userBegin, returnForSignin, insertCallback);
				} else {
					DB.insert('users', userBegin, returnForSignin, insertCallback);
				}
			}
		});
	});

}