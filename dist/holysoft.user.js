// ==UserScript==
// @name          Holysoft Musicbrainz Import
// @version       2025.2.23
// @namespace     https://github.com/Eichi76/musicbrainz-userscripts
// @author        Eichi76
// @description   Importiert Hörspielproduktionen aus dem Holysoft Shop und erstellt einen String, um die entsprechende Crew bei Musicbrainz hinzuzufügen.
// @homepageURL   https://github.com/Eichi76/musicbrainz-userscripts#holysoft-musicbrainz-import
// @downloadURL   https://raw.github.com/Eichi76/musicbrainz-userscripts/main/dist/holysoft.user.js
// @updateURL     https://raw.github.com/Eichi76/musicbrainz-userscripts/main/dist/holysoft.user.js
// @supportURL    https://github.com/Eichi76/musicbrainz-userscripts/issues
// @grant         none
// @match         *://shop.holysoft.de/produkte/*
// ==/UserScript==

(function () {
	'use strict';

	const urlTypeIds = /** @type {const} */ ({
		'production': 72,
		'amazon asin': 77,
		'discography entry': 288,
		'license': 301,
		'get the music': 73,
		'purchase for mail-order': 79,
		'purchase for download': 74,
		'download for free': 75,
		'free streaming': 85,
		'streaming': 980,
		'crowdfunding page': 906,
		'show notes': 729,
		'other databases': 82,
		'discogs': 76,
		'vgmdb': 86,
		'secondhandsongs': 308,
		'allmusic': 755,
		'BookBrainz': 850,
	});

	/**
	 * Returns the first element that is a descendant of node that matches selectors.
	 * @param {string} selectors 
	 * @param {ParentNode} node 
	 */
	function qs(selectors, node = document) {
		return node.querySelector(selectors);
	}

	/**
	 * Returns all element descendants of node that match selectors.
	 * @param {string} selectors 
	 * @param {ParentNode} node 
	 */
	function qsa(selectors, node = document) {
		return node.querySelectorAll(selectors);
	}

	/**
	 * Builds an edit note for the given message sections and adds a footer section for the active userscript.
	 * Automatically de-duplicates the sections to reduce auto-generated message and footer spam.
	 * @param {...string} sections Edit note sections.
	 * @returns {string} Complete edit note content.
	 */
	function buildEditNote(...sections) {
		sections = sections.map((section) => section.trim());

		if (typeof GM_info !== 'undefined') {
			sections.push(`${GM_info.script.name} (v${GM_info.script.version}, ${GM_info.script.namespace})`);
		}

		// drop empty sections and keep only the last occurrence of duplicate sections
		return sections
			.filter((section, index) => section && sections.lastIndexOf(section) === index)
			.join(editNoteSeparator);
	}

	const editNoteSeparator = '\n—\n';

	/**
	 * @template Params
	 * @template Result
	 * @template {string | number} Key
	 */
	class FunctionCache {
		/**
		 * @param {(...params: Params) => Result | Promise<Result>} expensiveFunction Expensive function whose results should be cached.
		 * @param {Object} options
		 * @param {(...params: Params) => Key[]} options.keyMapper Maps the function parameters to the components of the cache's key.
		 * @param {string} [options.name] Name of the cache, used as storage key (optional).
		 * @param {Storage} [options.storage] Storage which should be used to persist the cache (optional).
		 * @param {Record<Key, Result>} [options.data] Record which should be used as cache (defaults to an empty record).
		 */
		constructor(expensiveFunction, options) {
			this.expensiveFunction = expensiveFunction;
			this.keyMapper = options.keyMapper;
			this.name = options.name ?? `defaultCache`;
			this.storage = options.storage;
			this.data = options.data ?? {};
		}

		/**
		 * Looks up the result for the given parameters and returns it.
		 * If the result is not cached, it will be calculated and added to the cache.
		 * @param {Params} params 
		 */
		async get(...params) {
			const keys = this.keyMapper(...params);
			const lastKey = keys.pop();
			if (!lastKey) return;

			const record = this._get(keys);
			if (record[lastKey] === undefined) {
				// create a new entry to cache the result of the expensive function
				const newEntry = await this.expensiveFunction(...params);
				if (newEntry !== undefined) {
					record[lastKey] = newEntry;
				}
			}

			return record[lastKey];
		}

		/**
		 * Manually sets the cache value for the given key.
		 * @param {Key[]} keys Components of the key.
		 * @param {Result} value 
		 */
		set(keys, value) {
			const lastKey = keys.pop();
			this._get(keys)[lastKey] = value;
		}

		/**
		 * Loads the persisted cache entries.
		 */
		load() {
			const storedData = this.storage?.getItem(this.name);
			if (storedData) {
				this.data = JSON.parse(storedData);
			}
		}

		/**
		 * Persists all entries of the cache.
		 */
		store() {
			this.storage?.setItem(this.name, JSON.stringify(this.data));
		}

		/**
		 * Clears all entries of the cache and persists the changes.
		 */
		clear() {
			this.data = {};
			this.store();
		}

		/**
		 * Returns the cache record which is indexed by the key.
		 * @param {Key[]} keys Components of the key.
		 */
		_get(keys) {
			let record = this.data;
			keys.forEach((key) => {
				if (record[key] === undefined) {
					// create an empty record for all missing keys
					record[key] = {};
				}
				record = record[key];
			});
			return record;
		}
	}

	/**
	 * @template Params
	 * @template Result
	 * @template {string | number} Key
	 * @extends {FunctionCache<Params, Result, Key>}
	 */
	class SimpleCache extends FunctionCache {
		/**
		* @param {Object} options
		* @param {string} [options.name] Name of the cache, used as storage key (optional).
		* @param {Storage} [options.storage] Storage which should be used to persist the cache (optional).
		* @param {Record<Key, Result>} [options.data] Record which should be used as cache (defaults to an empty record).
		*/
		constructor(options) {
			// use a dummy function to make the function cache fail without actually running an expensive function
			super((...params) => undefined, {
				...options,
				keyMapper: (...params) => params,
			});
		}
	}

	/** @type {SimpleCache<[entityType: CoreEntityTypeT, name: string], MB.MBID>} */
	const nameToMBIDCache = new SimpleCache({
		name: 'nameToMBIDCache',
		storage: window.localStorage,
	});

	/**
	 * Creates a hidden input element.
	 * @param {string} name Name of the input element.
	 * @param {string} value Value of the input element.
	 */
	function createHiddenInput(name, value) {
		const input = document.createElement('input');
		input.setAttribute('type', 'hidden');
		input.name = name;
		input.value = value;
		return input;
	}

	/**
	 * Creates a form with hidden inputs for the given data.
	 * @param {import('../types.d.ts').FormDataRecord} data Record with one or multiple values for each key.
	 */
	function createHiddenForm(data) {
		const form = document.createElement('form');
		form.append(...
			Object.entries(data).flatMap(([key, value]) => {
				if (Array.isArray(value)) {
					return value.map((singleValue) => createHiddenInput(key, singleValue));
				}
				return createHiddenInput(key, value);
			})
		);
		return form;
	}

	/**
	 * Creates a DOM element from the given HTML fragment.
	 * @param {string} html HTML fragment.
	 */
	function createElement(html) {
		const template = document.createElement('template');
		template.innerHTML = html;
		return template.content.firstElementChild;
	}

	/**
	 * Creates a style element from the given CSS fragment and injects it into the document's head.
	 * @param {string} css CSS fragment.
	 * @param {string} userscriptName Name of the userscript, used to generate an ID for the style element.
	 */
	function injectStylesheet(css, userscriptName) {
		const style = document.createElement('style');
		if (userscriptName) {
			style.id = [userscriptName, 'userscript-css'].join('-');
		}
		style.innerText = css;
		document.head.append(style);
	}

	/**
	 * Extracts the entity type and ID from a MusicBrainz URL (can be incomplete and/or with additional path components and query parameters).
	 * @param {string} url URL of a MusicBrainz entity page.
	 * @returns {{ type: CoreEntityTypeT | 'mbid', mbid: MB.MBID } | undefined} Type and ID.
	 */
	function extractEntityFromURL(url) {
		const entity = url.match(/(area|artist|event|genre|instrument|label|mbid|place|recording|release|release-group|series|url|work)\/([0-9a-f-]{36})(?:$|\/|\?)/);
		return entity ? {
			type: entity[1],
			mbid: entity[2]
		} : undefined;
	}

	/**
	 * @param {CoreEntityTypeT} entityType 
	 * @param {MB.MBID | 'add' | 'create'} mbid MBID of an existing entity or `create` for the entity creation page (`add` for releases).
	 */
	function buildEntityURL(entityType, mbid) {
		return `https://musicbrainz.org/${entityType}/${mbid}`;
	}

	/**
	 * Constructs a tooltip for the given entity.
	 * @param {MB.Entity} entity 
	 */
	function getEntityTooltip(entity) {
		let tooltip = `${entity.type}: ${entity['sort-name'] ?? entity.title}`; // fallback for releases
		if (entity.disambiguation) tooltip += ` (${entity.disambiguation})`;
		return tooltip;
	}

	/**
	 * Flattens the given (potentially nested) record into a record with a single hierarchy level.
	 * Concatenates the keys in a nested structure which lead to a value with dots.
	 * @param {Record<string, any>} record 
	 * @param {string[]} preservedKeys - Keys whose values will be preserved.
	 * @returns {Record<string, any>}
	 */
	function flatten(record, preservedKeys = []) {
		const flatRecord = {};

		for (const key in record) {
			let value = record[key];
			if (typeof value === 'object' && value !== null && !preservedKeys.includes(key)) { // also matches arrays
				value = flatten(value, preservedKeys);
				for (const childKey in value) {
					flatRecord[key + '.' + childKey] = value[childKey]; // concatenate keys
				}
			} else if (value !== undefined) { // value is already flat (e.g. a string) or should be preserved
				flatRecord[key] = value; // keep the key
			}
		}

		return flatRecord;
	}

	/**
	 * Creates an object from the given arrays of keys and corresponding values.
	 * @template T
	 * @param {PropertyKey[]} keys
	 * @param {T[]} values
	 */
	function zipObject(keys, values) {
		return Object.fromEntries(keys.map((_, index) => [keys[index], values[index]]));
	}

	/**
	 * Returns a promise that resolves after the given delay.
	 * @param {number} ms Delay in milliseconds.
	 */
	function delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	// Adapted from https://thoughtspile.github.io/2018/07/07/rate-limit-promises/


	function rateLimitedQueue(operation, {
		interval,
		maxQueueSize = Infinity,
		queueFullError = 'Max queue size reached',
	}) {
		// Empty queue is ready.
		let queue = Promise.resolve();
		let queueSize = 0;

		return (...args) => {
			if (queueSize >= maxQueueSize) {
				return Promise.reject(new Error(queueFullError));
			}

			// Queue the next operation.
			const result = queue.then(() => operation(...args));
			queueSize++;

			// Decrease queue size when the operation finishes (succeeds or fails).
			result.then(() => { queueSize--; }, () => { queueSize--; });

			// Start the next delay, regardless of the last operation's success.
			queue = queue.then(() => delay(interval), () => delay(interval));

			return result;
		};
	}

	/**
	 * Limits the number of requests for the given operation within a time interval.
	 * @template Params
	 * @template Result
	 * @param {(...args: Params) => Result} operation Operation that should be rate-limited.
	 * @param {object} options
	 * @param {number} options.interval Time interval (in ms).
	 * @param {number} [options.requestsPerInterval] Maximum number of requests within the interval.
	 * @param {number} [options.maxQueueSize] Maximum number of requests which are queued (optional).
	 * @param {string} [options.queueFullError] Error message when the queue is full.
	 * @returns {(...args: Params) => Promise<Awaited<Result>>} Rate-limited version of the given operation.
	 */
	function rateLimit(operation, options) {
		const { requestsPerInterval = 1 } = options;

		if (requestsPerInterval == 1) {
			return rateLimitedQueue(operation, options);
		}

		const queues = Array(requestsPerInterval).fill().map(() => rateLimitedQueue(operation, options));
		let queueIndex = 0;

		return (...args) => {
			queueIndex = (queueIndex + 1) % requestsPerInterval; // use the next queue
			return queues[queueIndex](...args); // return the result of the operation
		};
	}

	/**
	 * Calls to the MusicBrainz API are limited to one request per second.
	 * https://musicbrainz.org/doc/MusicBrainz_API
	 */
	const callAPI = rateLimit(fetch, 1000);

	/**
	 * Requests the given entity from the MusicBrainz API.
	 * @param {string} url (Partial) URL which contains the entity type and the entity's MBID.
	 * @param {string[]} inc Include parameters which should be added to the API request.
	 * @returns {Promise<MB.Entity>}
	 */
	function fetchEntity(url, inc) {
		const entity = extractEntityFromURL(url);
		if (!entity) throw new Error('Invalid entity URL');

		const endpoint = [entity.type, entity.mbid].join('/');
		return fetchFromAPI(endpoint, {}, inc);
	}

	/**
	 * Makes a request to the MusicBrainz API of the currently used server and returns the results as JSON.
	 * @param {string} endpoint Endpoint (e.g. the entity type) which should be queried.
	 * @param {Record<string,string>} query Query parameters.
	 * @param {string[]} inc Include parameters which should be added to the query parameters.
	 */
	async function fetchFromAPI(endpoint, query = {}, inc = []) {
		if (inc.length) {
			query.inc = inc.join(' '); // spaces will be encoded as `+`
		}
		query.fmt = 'json';
		const headers = {
			'Accept': 'application/json',
			// 'User-Agent': 'Application name/<version> ( contact-url )',
		};
		const response = await callAPI(`https://musicbrainz.org/ws/2/${endpoint}?${new URLSearchParams(query)}`, { headers });
		if (response.ok) {
			return response.json();
		} else {
			throw response;
		}
	}

	/**
	 * Converts an array with a single element into a scalar.
	 * @template T
	 * @param {T | T[]} maybeArray 
	 * @returns A scalar or `undefined` if the conversion is not possible.
	 */
	function toScalar(maybeArray) {
		if (Array.isArray(maybeArray)) {
			if (maybeArray.length === 1) return maybeArray[0];
		} else {
			return maybeArray;
		}
	}

	/**
	 * Converts the name from kebab case into title case.
	 * @param {string} name
	 */
	function kebabToTitleCase(name) {
		return name.split('-')
			.map(upperCaseFirstLetter)
			.join(' ');
	}

	/** @param {string} word */
	function upperCaseFirstLetter(word) {
		return word.replace(/^./, c => c.toUpperCase());
	}

	// TODO Ein wenig mehr CSS für Musicbrainz Importer

	const langObject = {
		en: {
			seedbutton: {
				text: 'IMPORT INTO MUSICBRAINZ',
				title: 'Import this release into MusicBrainz (open a new tab)',
			},
			inputfield: {
				first: 'MBID or URL',
				last: 'any entity',
			},
			copyButton: {
				title: 'Copy voice actor credits to clipboard',
				text: 'COPY CREDITS TO CLIPBOARD',
				successText: 'CREDITS COPIED!',
			},
			entityType: {
				artist: 'Artist',
				label: 'Label',
				name: 'Release Name',
				'Release Group': 'Release Group',
			},
			releaseinput: {
				placeholder: 'Enter Album Name',
			},
			error: {
				first: 'Entity type ',
				last: ' is not allowed',
			},
		},
		de: {
			seedbutton: {
				text: 'IN MUSICBRAINZ IMPORTIEREN',
				title: 'Importiere diese Veröffentlichung in MusicBrainz (öffnet einen neuen Tab)',
			},
			inputfield: {
				first: 'MBID oder URL',
				last: 'jede Art',
			},
			copyButton: {
				title: 'Rollen/Sprecher in die Zwischenablage kopieren',
				text: 'SPRECHER IN ZWISCHENABLAGE KOPIEREN',
				successText: 'SPRECHER KOPIERT!',
			},
			entityType: {
				artist: 'Künstler',
				label: 'Label',
				name: 'Veröffentlichungsname',
				'Release Group': 'Veröffentlichungsgruppe',
			},
			releaseinput: {
				placeholder: 'Album Name eingeben',
			},
			error: {
				first: 'Entity Typ ',
				last: ' ist nicht erlaubt',
			},
		},
	};
	//const currentLang = /\w+/.exec(document.documentElement.lang); // Setzt die Sprache der Seite
	const currentLang = navigator.language.split('-')[0]; // Setzt die Sprache der Seite
	const currentLangObject = langObject[getAvailableLanguage(langObject, currentLang)];

	const relMapping = {
		Audio_director: {
			id: 1187,
			uuid: '4e088178-ea6f-4194-a801-10b4f0f03154',
			relTyp: 'Audio_director',
		},
		Writer: {
			id: 54,
			uuid: 'ca7a474a-a1cd-4431-9230-56a17f553090',
			relTyp: 'Writer',
		},
		Producer: {
			id: 30,
			uuid: '8bf377ba-8d71-4ecc-97f2-7bb2d8a2a75f',
			relTyp: 'Producer',
		},
		Sound_effects: {
			id: 1235,
			uuid: 'bc2bff29-f75c-47ff-94dc-9c9652d1a987',
			relTyp: 'Sound_effects',
		},
		Spoken_vocals: {
			id: 60,
			uuid: 'd3a36e62-a7c4-4eb9-839f-adfebe87ac12',
			relTyp: 'Spoken_vocals',
		},
	};

	/**
	 * @description Ermittelt ob eine Sprache vorhanden ist
	 * @param jsonObject // JSON Object mit Sprachangaben
	 * @param lang // Die aktuelle Sprache
	 * @return Gefundene Sprache oder Englisch als Fallback
	 */
	function getAvailableLanguage(jsonObject, lang) {
		let availableLang = 'en'; // setzt die Variabel auf Englisch
		if (jsonObject[lang] != undefined) {
			// Wenn die Sprache im Objekt gefunden wurde....
			availableLang = lang; // ... setze die Sprache als verfügbare Sprache
		}
		return availableLang;
	}

	/**
	 * @description Übersetzt gegebene Entity Namen in die gegebene Sprache
	 * @author Eichi76
	 * @date 2025-02-21
	 * @param {CoreEntityTypeT[]} [allowedEntityTypes] Erlaubte Entity Tyoeb
	 * @returns {[*]} Übersetzte Entity Typen
	 */
	function translateEntityTypes(allowedEntityTypes) {
		return allowedEntityTypes.map((el) => currentLangObject['entityType'][el]);
	}

	/**
	 * @description Sammelt Release URL, Episoden Nummer und Episoden Name
	 * @author Eichi76
	 * @date 2025-02-21
	 */
	function collectInfos() {
		episode['releaseUrl'] = new URL(window.location);
		episode['serieName'] = qs('h2.product_grid_full_title > a').innerText.trim();
		let { episodeNr, episodeTitle } = /^(?<episodeNr>\d+):(?<episodeTitle>.+)$/.exec(
			qs('h3.product_grid_full_subtitle').innerText.trim()
		).groups;
		episode['episodeNr'] = episodeNr;
		episode['episodeTitle'] = episodeTitle;
	}

	/**
	 * @description Fügt Episoden Object Detailelemente hinzu
	 * @author Eichi76
	 * @date 2025-02-08
	 */
	function collectDetails() {
		Array.from(qsa('#product_details > .product_full_extrainfo_left > p')).map((p) => {
			let { key, value } = /^<b>(?<key>.*?)<\/b> (?<value>.+)$/.exec(p.innerHTML).groups;
			[key, value] = convertDetails(key, value);
			if (key === '') {
				return;
			}
			episode[key.toLowerCase()] = value;
		});
	}

	/**
	 * @description Erstellt ein Array mit Schauspieler Objekten
	 * @author Eichi76
	 * @date 2025-02-22
	 * @returns {[{actor}]}
	 */
	function collectActors() {
		let actors = [];
		let job = 'Spoken_vocals';
		let actorsDetails = qsa('#product_mitwirkende > .product_full_extrainfo_right > p');
		Array.from(actorsDetails).map((p) => {
			let actor = Array.from(qsa('a', p));
			let element = {};
			if (job in relMapping) {
				element['id'] = relMapping[job].id;
				element['uuid'] = relMapping[job].uuid;
				element['relType'] = relMapping[job].relTyp;
			}
			element['artist'] = actor[1].innerText.trim();
			element['creditedAs'] = '';
			element['roleName'] = actor[0].innerText.trim();
			actors.push(element);
		});
		return actors;
	}

	/**
	 * @description Konvertiert gegebene Key/Values zu standartisierten Werten
	 * @author Eichi76
	 * @date 2025-02-08
	 * @param {string} key Obeject Key
	 * @param {string} value
	 * @returns {Array} Meue Standartisierte Werte für key und value
	 */
	function convertDetails(key, value) {
		let artist;
		switch (key) {
			case 'ANZAHL DATENTRÄGER':
				key = 'discs';
				break;

			case 'GENRE':
			case 'IM STREAMING ABO ENTHALTEN AB':
				key = '';
				break;

			case 'IM HOLYSHOP ERHÄLTLICH AB':
			case 'ERSTERSCHEINUNG':
				key = 'releaseDate';
				value = new Date(value.slice(6), value[3] + value[4] - 1, value[0] + value[1]);
				break;

			case 'ISBN':
				key = 'barcode';
				value = value.replaceAll('-', '');
				break;

			case 'Regie':
				//key = 'director';
				//key = 'Audio_director';
				artist = value;
				value = relMapping.Audio_director;
				value['name'] = artist;
				value['reltyp'] = 'Audio_director';
				break;
		}
		return [key, value];
	}

	/**
	 * @description Konvertiert gegebene Job Name zum standartisierten Namen
	 * @author Eichi76
	 * @date 2025-02-22
	 * @param {string} relName Job Name der Seite (Regie, Produktuib,,,)
	 * @returns {string} Standartisierten String des Job Namens
	 */
	function convertRelName(relName) {
		let ret = relName;
		switch (relName) {
			case 'Regie':
				ret = 'Audio_director';
				break;
			case 'Skript':
				ret = 'Writer';
				break;
			case 'Produktion':
				ret = 'Producer';
				break;
			case 'Sounddesign':
				ret = 'Sound_effects';
				break;
		}
		return ret;
	}

	/**
	 * @description Erstellt ein Array mit Crew Mitglieder Objekten und ihrer Job zugehörigkeit
	 * @author Eichi76
	 * @date 2025-02-22
	 * @returns {[{member}]} Array mit Crew Mitglieder Objekten
	 */
	function collectCrew() {
		let crew = [];
		let crewDetails = qsa('#product_mitwirkende > .product_full_extrainfo_left > p');
		Array.from(crewDetails).map((p) => {
			let job = convertRelName(qs('b', p).innerText.trim());
			Array.from(qsa('a', p)).map((a) => {
				let member = {};
				if (job in relMapping) {
					member['id'] = relMapping[job].id;
					member['uuid'] = relMapping[job].uuid;
					member['relType'] = relMapping[job].relTyp;
				}
				member['artist'] = a.innerText.trim();
				crew.push(member);
			});
		});
		return crew;
	}

	/**
	 * @description Erstellt Episoden Object und fügt alle Elemente zusammen
	 * @author Eichi76
	 * @date 2025-02-08
	 * @returns {object}
	 */
	function createEpisode() {
		episode['crew'] = collectCrew();
		episode['actors'] = collectActors();
		collectInfos();
		collectDetails();

		return episode;
	}

	/**
	 * @description Erstellt Array mit Mediums und Tracks
	 * @author Eichi76
	 * @date 2025-02-21
	 * @returns {[mediums]} Erstelltes Array mit Medien und dazugehörigen Tracks
	 */
	function insertMediums() {
		let discs = 1; // Setzt Discanzahl
		let trackCounters = []; // trackcounters Array Deklarieren
		let format = 'Digital Media'; // Standardformat
		let mediums = []; // deklariert Array für einzelne Medien
		let counttracks = 0; // Zöhler für Gesamtzahl der Tracks

		// Wenn die Anzahl der Discs bekannt ist wird sie gesetzt
		if ('discs' in episode) {
			discs = episode.discs;
		}

		// Setzt die Anzahl der Tracks für jedes Medium auf 1
		for (let index = 0; index < discs; index++) {
			trackCounters.push('1');
		}

		// Liest die jeweilige Trackanzahl aus Inputfeldern
		if (qsa('input[type="number"]').length > 0) {
			trackCounters = Array.from(qsa('input[type="number"]')).map((el) => el.value);
		}

		// Wenn ein bestimmtes Format erkannt wurde wird es MB Komform gesetzt
		if (episode.format) {
			switch (episode.format) {
				case 'Audio-CD':
					format = 'CD';
					break;
			}
		}

		// Schleife durch Anzahl der Medien
		for (let i = 0; i < discs; i++) {
			const medium = {
				format: format,
				track: [],
			};
			// Erstellen von Trackobjekten anhand der gegebenen Trackanzahl
			for (let x = 0; x < trackCounters[i]; x++) {
				counttracks++; // Gesamtzähler hochsetzen
				let trackObj = {
					number: x + 1,
					name: `${episode.episodeTitle}, Kapitel ${String(counttracks).padStart(2, '0')}`,
				};
				// Wenn es ein Onetrack ist speziellen Namen vergeben
				if (discs == 1 && trackCounters[i] == 1) {
					trackObj['name'] = `${episode.episodeNr}: ${episode.episodeTitle}`;
				}
				medium.track.push(trackObj);
			}
			mediums.push(medium);
		}
		return mediums;
	}

	/**
	 * @description Erstellt einen JSON Objekt aus Crew und Actors
	 * @author Eichi76
	 * @date 2025-02-22
	 * @returns {*}  Objekt aus ReleaseUrl, Crew Objekt und Actors Objekt
	 */
	function jsonFromCrew() {
		let crewObject = {};
		crewObject['releaseURL'] = episode.releaseUrl.href;
		crewObject['crew'] = episode.crew;
		crewObject['actors'] = episode.actors;
		return crewObject;
	}

	/**
	 * Loads the MBIDs of cached entity names for the given release seed.
	 * @param {MB.ReleaseSeed} release
	 * @returns Name, type and MBID (if already given or found in the cache) of the related entities.
	 */
	async function loadCachedEntitiesForRelease(release) {
		return Promise.all([
			...loadCachedArtists(release.artist_credit),
			...loadCachedLabels(release),
			...(release.mediums?.flatMap(
				(medium) => medium.track?.flatMap((track) => loadCachedArtists(track.artist_credit)) ?? []
			) ?? []),
		]).then((entities) => entities.filter((entity) => entity));
	}

	/** @param {MB.ArtistCreditSeed} artistCredit */
	function loadCachedArtists(artistCredit) {
		return (
			artistCredit?.names.map((credit) => loadCachedMBID(credit, 'artist', credit.artist?.name ?? credit.name)) ?? []
		);
	}

	/** @param {MB.ReleaseSeed} release */
	function loadCachedLabels(release) {
		return release.labels?.map((label) => loadCachedMBID(label, 'label', label.name)) ?? [];
	}

	/**
	 * @param {{ mbid: MB.MBID }} entity
	 * @param {CoreEntityTypeT} type
	 * @param {string} name
	 * @returns Type and name of the entity if it was not found in the cache.
	 */
	async function loadCachedMBID(entity, type, name) {
		let mbid = entity.mbid;

		if (!mbid) {
			mbid = await nameToMBIDCache.get(type, name);
			if (mbid) {
				entity.mbid = mbid;
			}
		}

		return { type, name, mbid };
	}

	/**
	 * Creates a form with hidden inputs and a submit button to seed a new release on MusicBrainz.
	 * @param {MB.ReleaseSeed} releaseData Data of the release.
	 */
	function createReleaseSeederForm(releaseData) {
		const form = createHiddenForm(flatten(releaseData, ['type']));
		form.action = buildEntityURL('release', 'add');
		form.method = 'POST';
		form.target = '_blank';
		form.name = 'musicbrainz-release-seeder';
		form.classList.add('product_play_button');

		const importButton = document.createElement('button');
		const icon = document.createElement('img');
		icon.src = '//musicbrainz.org/favicon.ico';
		importButton.append(icon, currentLangObject['seedbutton'].text);
		importButton.title = currentLangObject['seedbutton'].title;
		importButton.id = 'mbseed-button';
		importButton.classList.add('product_play_button', 'product_intowk_text');
		form.appendChild(importButton);

		return form;
	}

	/**
	 * Creates an input element where you can paste an MBID or an MB entity URL.
	 * It automatically validates the content on paste, loads the name of the entity and sets the MBID as a data attribute.
	 * @param {string} id ID and name of the input element.
	 * @param {CoreEntityTypeT[]} [allowedEntityTypes] Entity types which are allowed for this input, defaults to all.
	 * @param {string} [initialValue] Initial value of the input element.
	 */
	function createMBIDInput(id, allowedEntityTypes, initialValue) {
		/** @type {HTMLInputElement} */
		const mbidInput = document.createElement('input');
		mbidInput.className = 'mbid';
		mbidInput.name = mbidInput.id = id;
		mbidInput.placeholder = `${currentLangObject['inputfield'].first} (${
		translateEntityTypes(allowedEntityTypes)?.join('/') ?? currentLangObject['inputfield'].last
	})`;
		const mbidAttribute = 'data-mbid';
		const defaultEntityTypeRoute = toScalar(allowedEntityTypes) ?? 'mbid';

		if (initialValue) {
			setInputValue(initialValue);
		}

		mbidInput.addEventListener('input', async function () {
			const entity = await setInputValue(this.value.trim());
			if (entity) {
				mbidInput.dispatchEvent(new CustomEvent('mbid-input', { detail: entity }));
			}
		});

		return mbidInput;

		/** @param {string} entityURL */
		async function setInputValue(entityURL) {
			// create a complete entity identifier for an MBID only input
			if (entityURL.match(/^[0-9a-f-]{36}$/)) {
				entityURL = [defaultEntityTypeRoute, entityURL].join('/');
			}

			// reset previous validation results
			mbidInput.removeAttribute(mbidAttribute);
			mbidInput.classList.remove('error', 'success');
			mbidInput.title = '';

			// validate entity type and MBID
			try {
				const entity = extractEntityFromURL(entityURL);
				if (entity) {
					if (typeof allowedEntityTypes === 'undefined' || allowedEntityTypes.includes(entity.type)) {
						const result = await fetchEntity(entityURL);
						result.type ||= kebabToTitleCase(entity.type); // fallback for missing type
						mbidInput.setAttribute(mbidAttribute, result.id);
						mbidInput.value = result.name || result.title; // releases only have a title attribute
						mbidInput.classList.add('success');
						mbidInput.title = getEntityTooltip(result);
						return result;
					} else {
						throw new Error(
							`${currentLangObject['error'].first} '${currentLangObject['entityType'][kebabToTitleCase(entity.type)]}' ${
							currentLangObject['error'].last
						}`
						);
					}
				}
			} catch (error) {
				mbidInput.classList.add('error');
				mbidInput.title = error.message ?? error.statusText;
			}
		}
	}

	/** @param {MB.ReleaseSeed} release */
	async function injectUI(release) {
		// load the MBIDs for all cached entity names
		nameToMBIDCache.load();
		const relatedEntities = await loadCachedEntitiesForRelease(release);

		// create a table where the user can enter entity name to MBID mappings
		const entityMappings = createElement(`<table id="mbid-mapping"><caption>MUSICBRAINZ MAPPING</caption></table>`);
		relatedEntities.forEach((entity, index) => {
			const id = `mbid-mapping-${index}`;
			const tr = createElement(`<tr><td>${currentLangObject['entityType'][entity.type]}:</td></tr>`);
			//const tr = createElement(`<tr><td></td></tr>`);
			const td = document.createElement('td');

			let initialMappingValue;
			if (entity.mbid) {
				initialMappingValue = [entity.type, entity.mbid].join('/');
			}

			const mbidInput = createMBIDInput(id, [entity.type], initialMappingValue);
			td.appendChild(mbidInput);
			tr.appendChild(td);
			entityMappings.appendChild(tr);

			// update cache and importer form if the user pasted an MBID mapping
			mbidInput.addEventListener('mbid-input', async (event) => {
				const mbid = event.detail.id;
				nameToMBIDCache.set([entity.type, entity.name], mbid);
				nameToMBIDCache.store();
				await loadCachedEntitiesForRelease(release);
				injectImporterForm();
			});
		});

		const releaseRow = createElement(`<tr><td>${currentLangObject['entityType']['name']}:</td></tr>`);
		const releaseCol = document.createElement('td');
		const releaseInput = document.createElement('input');
		releaseInput.className = 'mbid';
		releaseInput.id = releaseInput.name = `mbid-mapping-${
		entityMappings.querySelectorAll("[id^='mbid-mapping-']").length
	}`;

		releaseInput.placeholder = `${currentLangObject['releaseinput']['placeholder']}`;
		releaseInput.value = release.name;
		releaseInput.addEventListener('input', function () {
			release.name = releaseInput.value;
			injectImporterForm();
		});

		releaseCol.appendChild(releaseInput);
		releaseRow.appendChild(releaseCol);
		entityMappings.appendChild(releaseRow);

		let discElements = episode.discs ?? 1;
		for (let index = 1; index <= discElements; index++) {
			const tr = createElement(`<tr><td>Medium ${index} Tracks:</td></tr>`);
			const td = document.createElement('td');
			let trackcount = createNumberInput(release);
			tr.className = 'medium';
			td.appendChild(trackcount);
			tr.appendChild(td);
			entityMappings.appendChild(tr);
		}
		// inject under the cover section
		const importerContainer = qs('.product_grid_full_coverarea');
		importerContainer.append(entityMappings);

		// inject a button to copy credits
		/** @type {HTMLButtonElement} */
		const copyButton = document.createElement('button');
		copyButton.type = 'button';
		copyButton.classList.add('product_grid_full_wishlist');
		copyButton.title = currentLangObject['copyButton'].title;
		copyButton.innerText = currentLangObject['copyButton'].text;
		copyButton.addEventListener('click', (event) => {
			let copyString = episode['actors'].map((credit) => `${credit.roleName ?? ''} - ${credit.artist}`).join('\n');

			if (event.shiftKey) {
				copyString = JSON.stringify(jsonFromCrew());
			}
			console.log(copyString);
			navigator.clipboard?.writeText(copyString);
			copyButton.innerText = currentLangObject['copyButton'].successText;
		});
		injectImporterForm();

		function injectImporterForm() {
			const divImporterButtons = document.createElement('div');
			const form = createReleaseSeederForm(release);
			const existingForm = qs(`form[name="${form.getAttribute('name')}"]`);

			if (existingForm) {
				existingForm.replaceWith(form);
			} else {
				divImporterButtons.appendChild(form);
				divImporterButtons.appendChild(copyButton);
				importerContainer.appendChild(divImporterButtons);
			}
		}

		function createNumberInput(release) {
			/** @type {HTMLInputElement} */
			const numberInput = document.createElement('input');
			numberInput.type = 'number';
			numberInput.min = 1;
			numberInput.max = 100;
			numberInput.step = 1;
			numberInput.value = 1;
			numberInput.addEventListener('input', function () {
				release.mediums = insertMediums();
				injectImporterForm();
			});
			return numberInput;
		}
	}

	const styles = `
input.error {
	background: #ebb1ba !important;
}
input.success {
	background: #b1ebb0;
}
input.mbid {
	width: 95%;
}
form[name='musicbrainz-release-seeder'] {
	padding: 0px;
}
form[name='musicbrainz-release-seeder'] button img {
	display: inline;
	vertical-align: middle;
	margin-right: 5px;
	padding: 0px;
}
#mbid-mapping {
	width: 100%;
	margin: 10px 0px 0px;
	border-spacing: revert;
}
#mbid-mapping caption {
	font-weight: bold;
}
#mbid-mapping td {
	padding: 3px;
}
#mbseed-button {
	border-width: 0px;
}
`;

	let episode = {};

	if (qs('#product_mitwirkende').querySelectorAll('.product_full_extrainfo_left > p').length > 0) {
		episode = createEpisode();
		const label = {
			name: 'Holysoft GmbH',
			mbid: 'c0233bbd-0dee-4989-aa4e-2bea2f3529b4',
		};
		const release = {
			name: `${episode.serieName} ${episode.episodeNr}: ${episode.episodeTitle}`,
			artist_credit: {
				names: [
					{
						name: episode.serieName,
						artist: {
							name: episode.serieName,
						},
					},
				],
			},
			type: ['Other', 'Audio drama'],
			events: [
				{
					date:
						zipObject(
							['day', 'month', 'year'],
							[episode.releasedate.getDate(), episode.releasedate.getMonth() + 1, episode.releasedate.getFullYear()]
						) ?? '',
					country: 'DE',
				},
			],
			labels: [label],
			language: 'deu',
			script: 'Latn',
			status: 'Official',
			barcode: '',
			packaging: 'None',
			mediums: insertMediums(),
			urls: [
				{
					url: episode['releaseUrl'].href,
					link_type: urlTypeIds['purchase for download'],
				},
			],
			edit_note: buildEditNote(`Imported Holysoft audio drama from ${episode['releaseUrl']}`),
		};

		if (episode.barcode) {
			release.barcode = episode.barcode;
		}
		if (episode.format === 'Audio-CD') {
			release.packaging = 'Jewel case';
			release.urls[0].link_type = urlTypeIds['purchase for mail-order'];
		}

		injectUI(release);
		injectStylesheet(styles, 'musicbrainz-importer');
	}

})();
