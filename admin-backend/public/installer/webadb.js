// SPDX-License-Identifier: MIT
// WebADB implementation (Google Chrome Labs / Tango)

(function(root, factory) {
	if (typeof define === 'function' && define.amd) {
		define([], factory);
	} else if (typeof exports === 'object') {
		module.exports = factory();
	} else {
		root.Adb = factory();
	}
}(this, function() {
	'use strict';

	let Adb = {};

	Adb.Opt = {};
	Adb.Opt.debug = false;
	Adb.Opt.dump = false;
	Adb.Opt.key_size = 2048;
	Adb.Opt.reuse_key = -1;
	Adb.Opt.use_checksum = true;

	let db = init_db();
	let keys = db.then(load_keys);

	Adb.open = function(transport) {
		if (transport == "WebUSB")
			return Adb.WebUSB.Transport.open();
		throw new Error("Unsupported transport: " + transport);
	};

	Adb.WebUSB = {};

	Adb.WebUSB.Transport = function(device) {
		this.device = device;
	};

	Adb.WebUSB.Transport.open = function() {
		let filters = [
			{ classCode: 255, subclassCode: 66, protocolCode: 1 },
			{ classCode: 255, subclassCode: 66, protocolCode: 3 }
		];

		return navigator.usb.requestDevice({ filters: filters })
			.then(device => device.open()
				.then(() => new Adb.WebUSB.Transport(device)));
	};

	Adb.WebUSB.Transport.prototype.close = function() {
		return this.device.close();
	};

	Adb.WebUSB.Transport.prototype.reset = function() {
		return this.device.reset();
	};

	Adb.WebUSB.Transport.prototype.send = function(ep, data) {
		return this.device.transferOut(ep, data);
	};

	Adb.WebUSB.Transport.prototype.receive = function(ep, len) {
		return this.device.transferIn(ep, len).then(response => response.data);
	};

	Adb.WebUSB.Transport.prototype.find = function(filter) {
		for (let i in this.device.configurations) {
			let conf = this.device.configurations[i];
			for (let j in conf.interfaces) {
				let intf = conf.interfaces[j];
				for (let k in intf.alternates) {
					let alt = intf.alternates[k];
					if (filter.classCode == alt.interfaceClass &&
					    filter.subclassCode == alt.interfaceSubclass &&
					    filter.protocolCode == alt.interfaceProtocol) {
						return { conf: conf, intf: intf, alt: alt };
					}
				}
			}
		}
		return null;
	};

	Adb.WebUSB.Transport.prototype.getDevice = function(filter) {
		let match = this.find(filter);
		if (!match) throw new Error("No ADB interface found");
		return this.device.selectConfiguration(match.conf.configurationValue)
			.then(() => this.device.claimInterface(match.intf.interfaceNumber))
			.then(() => this.device.selectAlternateInterface(match.intf.interfaceNumber, match.alt.alternateSetting))
			.then(() => match);
	};

	Adb.WebUSB.Transport.prototype.connectAdb = function(banner) {
		let VERSION = 0x01000000;
		let VERSION_NO_CHECKSUM = 0x01000001;
		let MAX_PAYLOAD = 256 * 1024;
		let key_idx = 0;
		let AUTH_TOKEN = 1;

		let version_used = Adb.Opt.use_checksum ? VERSION : VERSION_NO_CHECKSUM;
		let m = new Adb.Message("CNXN", version_used, MAX_PAYLOAD, "" + banner + "\0");
		return this.getDevice({ classCode: 255, subclassCode: 66, protocolCode: 1 })
			.then(match => new Adb.WebUSB.Device(this, match))
			.then(adb => m.send_receive(adb)
				.then((function do_auth_response(response) {
					if (response.cmd != "AUTH" || response.arg0 != AUTH_TOKEN)
						return response;
					return keys.then(keys =>
						do_auth(adb, keys, key_idx++, response.data.buffer, do_auth_response));
				}))
				.then(response => {
					if (response.cmd != "CNXN")
						throw new Error("Failed to connect with '" + banner + "'");
					adb.max_payload = response.arg1;
					if (response.arg0 == VERSION_NO_CHECKSUM)
						Adb.Opt.use_checksum = false;
					adb.banner = new TextDecoder("utf-8").decode(response.data);
					return adb;
				})
			);
	};

	Adb.WebUSB.Device = function(transport, match) {
		this.transport = transport;
		this.max_payload = 4096;
		this.ep_in = get_ep_num(match.alt.endpoints, "in");
		this.ep_out = get_ep_num(match.alt.endpoints, "out");
		this.transport.reset();
	};

	Adb.WebUSB.Device.prototype.open = function(service) {
		return Adb.Stream.open(this, service);
	};

	Adb.WebUSB.Device.prototype.shell = function(command) {
		return Adb.Stream.open(this, "shell:" + command);
	};

	Adb.WebUSB.Device.prototype.send = function(data) {
		if (typeof data === "string") {
			let encoder = new TextEncoder();
			data = encoder.encode(data).buffer;
		}
		return this.transport.send(this.ep_out, data);
	};

	Adb.WebUSB.Device.prototype.receive = function(len) {
		return this.transport.receive(this.ep_in, len);
	};

	Adb.Message = function(cmd, arg0, arg1, data) {
		this.cmd = cmd;
		this.arg0 = arg0;
		this.arg1 = arg1;
		this.len = data ? (data.byteLength || data.length || 0) : 0;
		this.checksum = Adb.Opt.use_checksum ? checksum(data) : 0;
		this.magic = magic(cmd);
		this.data = data;
	};

	Adb.Message.prototype.send = function(adb) {
		let header = new ArrayBuffer(24);
		let view = new DataView(header);
		view.setUint32(0, str2int(this.cmd), true);
		view.setUint32(4, this.arg0, true);
		view.setUint32(8, this.arg1, true);
		view.setUint32(12, this.len, true);
		view.setUint32(16, this.checksum, true);
		view.setUint32(20, this.magic, true);

		let promise = adb.send(header);
		if (this.len > 0) {
			promise = promise.then(() => adb.send(this.data));
		}
		return promise;
	};

	Adb.Message.receive = function(adb) {
		return adb.receive(24).then(response => {
			if (response.byteLength < 24)
				throw new Error("Header response too short: " + response.byteLength);

			let view = new DataView(response.buffer, response.byteOffset, response.byteLength);
			let cmd = int2str(view.getUint32(0, true));
			let arg0 = view.getUint32(4, true);
			let arg1 = view.getUint32(8, true);
			let len = view.getUint32(12, true);

			let promise = Promise.resolve(new Uint8Array(0));
			if (len > 0) {
				promise = adb.receive(len).then(data => new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
			}

			return promise.then(data => new Adb.Message(cmd, arg0, arg1, data));
		});
	};

	Adb.Message.prototype.send_receive = function(adb) {
		return this.send(adb).then(() => Adb.Message.receive(adb));
	};

	Adb.Stream = function(adb, local_id, remote_id) {
		this.adb = adb;
		this.local_id = local_id;
		this.remote_id = remote_id;
	};

	Adb.Stream.open = function(adb, service) {
		let local_id = 1;
		let m = new Adb.Message("OPEN", local_id, 0, service + "\0");
		return m.send_receive(adb).then(response => {
			if (response.cmd !== "OKAY")
				throw new Error("Failed to open stream for " + service);
			return new Adb.Stream(adb, local_id, response.arg0);
		});
	};

	Adb.Stream.prototype.send = function(data) {
		let m = new Adb.Message("WRTE", this.local_id, this.remote_id, data);
		return m.send_receive(this.adb);
	};

	Adb.Stream.prototype.receive = function() {
		return Adb.Message.receive(this.adb).then(response => {
			if (response.cmd === "WRTE") {
				let ack = new Adb.Message("OKAY", this.local_id, this.remote_id, null);
				return ack.send(this.adb).then(() => response.data);
			}
			if (response.cmd === "CLSE") {
				let ack = new Adb.Message("CLSE", this.local_id, this.remote_id, null);
				return ack.send(this.adb).then(() => null);
			}
			return this.receive();
		});
	};

	Adb.Stream.prototype.readAll = async function() {
		let output = new Uint8Array(0);
		while (true) {
			let chunk = await this.receive();
			if (!chunk || chunk.length === 0) break;
			let newBuf = new Uint8Array(output.length + chunk.length);
			newBuf.set(output);
			newBuf.set(chunk, output.length);
			output = newBuf;
		}
		return new TextDecoder("utf-8").decode(output);
	};

	Adb.Stream.prototype.close = function() {
		let m = new Adb.Message("CLSE", this.local_id, this.remote_id, null);
		return m.send(this.adb);
	};

	// Helper utilities
	function get_ep_num(endpoints, direction) {
		for (let i in endpoints) {
			if (endpoints[i].direction === direction)
				return endpoints[i].endpointNumber;
		}
		return direction === "in" ? 1 : 2;
	}

	function str2int(str) {
		return (str.charCodeAt(0) | str.charCodeAt(1) << 8 | str.charCodeAt(2) << 16 | str.charCodeAt(3) << 24) >>> 0;
	}

	function int2str(num) {
		return String.fromCharCode(num & 0xff, num >> 8 & 0xff, num >> 16 & 0xff, num >> 24 & 0xff);
	}

	function checksum(data) {
		if (!data) return 0;
		let view = new Uint8Array(data.buffer || data);
		let sum = 0;
		for (let i = 0; i < view.length; i++) sum = (sum + view[i]) & 0xffffffff;
		return sum;
	}

	function magic(cmd) {
		return (str2int(cmd) ^ 0xffffffff) >>> 0;
	}

	function init_db() {
		return new Promise((resolve, reject) => {
			let req = indexedDB.open("LockSuiteADB", 1);
			req.onupgradeneeded = e => {
				let db = e.target.result;
				if (!db.objectStoreNames.contains("keys"))
					db.createObjectStore("keys", { keyPath: "id", autoIncrement: true });
			};
			req.onsuccess = e => resolve(e.target.result);
			req.onerror = () => resolve(null);
		});
	}

	function load_keys(db) {
		if (!db) return generate_key().then(k => [k]);
		return new Promise(resolve => {
			let tx = db.transaction(["keys"], "readonly");
			let store = tx.objectStore("keys");
			let req = store.getAll();
			req.onsuccess = e => {
				if (e.target.result && e.target.result.length > 0) {
					resolve(e.target.result.map(r => r.keyPair));
				} else {
					generate_key().then(k => {
						let wtx = db.transaction(["keys"], "readwrite");
						wtx.objectStore("keys").add({ keyPair: k });
						resolve([k]);
					});
				}
			};
			req.onerror = () => generate_key().then(k => [k]);
		});
	}

	function generate_key() {
		return crypto.subtle.generateKey(
			{ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-1" },
			true, ["sign", "verify"]
		);
	}

	function do_auth(adb, keys, key_idx, token_buf, callback) {
		let AUTH_SIGNATURE = 2;
		let AUTH_RSAKEY = 3;

		if (key_idx < keys.length) {
			return crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys[key_idx].privateKey, token_buf)
				.then(sig => {
					let m = new Adb.Message("AUTH", AUTH_SIGNATURE, 0, new Uint8Array(sig));
					return m.send_receive(adb).then(callback);
				});
		} else {
			return crypto.subtle.exportKey("spki", keys[0].publicKey).then(spki => {
				let b64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
				let pubKeyData = new TextEncoder().encode(b64 + " LockSuiteWebADB\0");
				let m = new Adb.Message("AUTH", AUTH_RSAKEY, 0, pubKeyData);
				return m.send_receive(adb).then(callback);
			});
		}
	}

	return Adb;
}));
