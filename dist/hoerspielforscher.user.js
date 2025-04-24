// ==UserScript==
// @name          Hoerspielforscher Musicbrainz Import
// @version       2025.4.24
// @namespace     https://github.com/Eichi76/musicbrainz-userscripts
// @author        Eichi76
// @description   Importiert Hörspielproduktionen von Hoerspielforschern
// @homepageURL   https://github.com/Eichi76/musicbrainz-userscripts#hoerspielforscher-musicbrainz-import
// @downloadURL   https://raw.github.com/Eichi76/musicbrainz-userscripts/hoerspielforscher/dist/hoerspielforscher.user.js
// @updateURL     https://raw.github.com/Eichi76/musicbrainz-userscripts/hoerspielforscher/dist/hoerspielforscher.user.js
// @supportURL    https://github.com/Eichi76/musicbrainz-userscripts/issues
// @grant         none
// @match         *://hoerspielforscher.de/kartei/hoerspiel?detail=*
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
			//sections.push(`${GM_info.script.name} (v${GM_info.script.version}, ${GM_info.script.namespace})`);
			sections.push(`${GM_info.script.name} (Eichi76 dev version) ( (v${GM_info.script.version})`);

		}

		// drop empty sections and keep only the last occurrence of duplicate sections
		return sections
			.filter((section, index) => section && sections.lastIndexOf(section) === index)
			.join(editNoteSeparator);
	}

	const editNoteSeparator = '\n—\n';

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
		mbidInput.placeholder = `MBID or URL (${allowedEntityTypes?.join('/') ?? 'any entity'})`;

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
						throw new Error(`Entity type '${kebabToTitleCase(entity.type)}' is not allowed`);
					}
				}
			} catch (error) {
				mbidInput.classList.add('error');
				mbidInput.title = error.message ?? error.statusText;
			}
		}
	}

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
	 * Creates a form with hidden inputs and a submit button to seed a new release on MusicBrainz.
	 * @param {MB.ReleaseSeed} releaseData Data of the release.
	 */
	function createReleaseSeederForm(releaseData) {
		const form = createHiddenForm(flatten(releaseData, ['type']));
		form.action = buildEntityURL('release', 'add');
		form.method = 'POST';
		form.target = '_blank';
		form.name = 'musicbrainz-release-seeder';
	console.log('Form erstellt');
		//const importButton = document.createElement('button');
		//const icon = document.createElement('img');
		//icon.src = '//musicbrainz.org/favicon.ico';
		//importButton.append(icon, 'Import into MusicBrainz');
		//importButton.title = 'Import this release into MusicBrainz (open a new tab)'
		//form.appendChild(importButton);

		return form;
	}

	console.log('Hörspielforscher triggered');

	// TODO: Wenn keine Crew bzw Sprecher vorhanden verhindern das der Kopier Button geklickt werden kann
	// #region little helpers
	/**
	 * @description  Entfernt unnötig Zeichen aus dem String
	 * @author Eichi76
	 * @date 2025-03-05
	 * @param {*} string
	 * @returns {*}  gesäuberter String
	 */
	function cleanString(string) {
		return string ? string.replace(/„|“/g, '') : undefined;
	}

	function validbarcode(barcode) {
		const code = `${barcode}`;
		const digits = () => /^\d{8,13}$/g.test(code);
		const validlengths = [8, 12, 13];
		if (!digits() || !validlengths.includes(code.length)) return false;

		let checksum = 0;
		const codelist = code.split('');
		const checkdigit = parseInt(codelist.pop(), 10);
		codelist.map((value, index) => {
			const digit = parseInt(value, 10);
			if (code.length % 2 === 1) checksum += index % 2 ? digit * 3 : digit;
			else checksum += index % 2 ? digit : digit * 3;
		});

		let check = checksum % 10;
		if (check !== 0) check = 10 - check;
		if (check === checkdigit) return true;
		return false;
	}

	function arraySort(array, key) {
		return array.sort((b, a) => b[`${key}`] - a[`${key}`]);
	}

	function capitalizeFirstLetter(val) {
		return String(val).charAt(0).toUpperCase() + String(val).slice(1);
	}

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

	// #endregion little helpers

	// #region Constants

	const styles = /* css */ `
#mbImporter, #importerContainer {
	width: 100%;
	background: #1c1b1b;
	color: #ffffff;
}
#importerContainer tr {
	padding: 5em;
}
td.right {
	text-align:right;
}
.toSeed {
	background: green;
	color: white;
}
.fromSeed {
	background: red;
	color: white;
}
#mbImporter > table {
	width: 100%;
	padding: 1em;
	margin-top: 2em;
}

#mbImporter input, #mbImporter textarea {
	background-color: #555555;
  	color: white;
}
#mbImporter input.error {
	background: #571620 !important;
}
#mbImporter input.success {
	background: #285816;
}
#mbImporter button > img, #importerContainer button > img {
	display: inline;
	vertical-align: middle;
	margin-right: 5px;
}
#mbImporter caption {
	font-weight: bold;
}
#mbImporter input[type="text"] {
     width: 100%;
     box-sizing: border-box;
}
#importerContainer button {
	cursor: pointer;
}
#importerContainer > button {
	width: 100%;
	background-color: green;
	color: white;
	border-color: white;
	border-width: 5px;
	margin: 4px;
}`;
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
	const currentLang = navigator.language.split('-')[0]; // Setzt die Sprache der Seite
	const currentLangObject = langObject[getAvailableLanguage(langObject, currentLang)];

	/** @type {*} Objekt mit allen auftretenden verwertbaren Aufgaben der Crew mit Musicbrainz Zuordnungen */
	const jobsObject = {
		Mischung: {
			mb: { name: '', targetType: 'artist', linktype: 'Mix', attributesTypes: [] },
			relTyp: 'Mix',
		},
		Schnittassistenz: {
			mb: { name: '', targetType: 'artist', linktype: 'Editor', attributesTypes: [{ type: 'assistant', text: '' }] },
			relTyp: 'Editor',
		},
		Schnitt: {
			mb: { name: '', targetType: 'artist', linktype: 'Editor', attributesTypes: [] },
			relTyp: 'Editor',
		},
		Produktion: {
			mb: { name: '', targetType: 'artist', linktype: 'Producer', attributesTypes: [] },
			relTyp: 'Producer',
		},
		'Künstlerische Gesamtleitung': {
			mb: { name: '', targetType: 'artist', linktype: 'Producer', attributesTypes: [{ type: 'executive', text: '' }] },
			relTyp: 'Producer',
		},
		Buch: {
			mb: { name: '', targetType: 'artist', linktype: 'Writer', attributesTypes: [] },
			relTyp: 'Writer',
		},
		Hörspielskript: {
			mb: { name: '', targetType: 'artist', linktype: 'Writer', attributesTypes: [] },
			relTyp: 'Writer',
		},
		Hörspielbearbeitung: {
			mb: { name: '', targetType: 'artist', linktype: 'Writer', attributesTypes: [] },
			relTyp: 'Writer',
		},
		Hörspielbuch: {
			mb: { name: '', targetType: 'artist', linktype: 'Writer', attributesTypes: [] },
			relTyp: 'Writer',
		},
		Spoken_vocals: {
			mb: { name: '', targetType: 'artist', linktype: 'Vocal', attributesTypes: [{ type: 'Spoken_vocals', text: '' }] },
			relTyp: 'Spoken_vocals',
		},
		Illustration: {
			mb: { name: '', targetType: 'artist', linktype: 'Illustration', attributesTypes: [] },
			relTyp: 'Illustration',
		},
		Coverillustration: {
			mb: { name: '', targetType: 'artist', linktype: 'Illustration', attributesTypes: [] },
			relTyp: 'Illustration',
		},
		Regieassistenz: {
			mb: {
				name: '',
				targetType: 'artist',
				linktype: 'Audio_director',
				attributesTypes: [{ type: 'assistant', text: '' }],
			},
			relTyp: 'Audio_director',
		},
		Sprachregie: {
			mb: { name: '', targetType: 'artist', linktype: 'Audio_director', attributesTypes: [] },
			relTyp: 'Audio_director',
		},
		Regie: {
			mb: { name: '', targetType: 'artist', linktype: 'Audio_director', attributesTypes: [] },
			relTyp: 'Audio_director',
		},
		Effekte: {
			mb: { name: '', targetType: 'artist', linktype: 'Sound_effects', attributesTypes: [] },
			relTyp: 'Sound_effects',
		},
		Sounddesign: {
			mb: { name: '', targetType: 'artist', linktype: 'Sound_effects', attributesTypes: [] },
			relTyp: 'Sound_effects',
		},
		Geräuschemacher: {
			mb: { name: '', targetType: 'artist', linktype: 'Sound_effects', attributesTypes: [] },
			relTyp: 'Sound_effects',
		},
		'Foley Recordings': {
			mb: { name: '', targetType: 'artist', linktype: 'Sound_effects', attributesTypes: [] },
			relTyp: 'Sound_effects',
		},
		Vorlage: {
			mb: { name: '', targetType: 'artist', linktype: 'Writer', attributesTypes: [] },
			relTyp: 'Writer',
		},
		Idee: {
			mb: { name: '', targetType: 'artist', linktype: 'Writer', attributesTypes: [] },
			relTyp: 'Writer',
		},
		'nach dem Jugendbuch von': {
			mb: { name: '', targetType: 'artist', linktype: 'Writer', attributesTypes: [] },
			relTyp: 'Writer',
		},
		'Nach dem Roman von': {
			mb: { name: '', targetType: 'artist', linktype: 'Writer', attributesTypes: [] },
			relTyp: 'Writer',
		},
		'Nach einem Buch von ': {
			mb: { name: '', targetType: 'artist', linktype: 'Writer', attributesTypes: [] },
			relTyp: 'Writer',
		},
		Redaktion: {
			mb: { name: '', targetType: 'artist', linktype: 'Nothing', attributesTypes: [] },
			relTyp: 'Nothing',
		},
		//'Ein Hörspiel nach dem Jugendbuch von': { id: 54, uuid: 'ca7a474a-a1cd-4431-9230-56a17f553090', relTyp: 'Writer' },
	};

	/** @type {*} Zusätzliche Infos auf der Seite*/
	const additionalInfos = {
		Veröffentlichung: 'releaseDate',
		Format: 'mediumformat',
	};

	/** @type {*} Objekt mit allen verfügbaren Medium Typen und deren Infos*/
	const mediumsTyps = {
		LP: { sides: 2, format: ['12"-Vinyl, 33 1/3 rpm'], mbmedium: '12" Vinyl', mbpackaging: 'Cardboard/Paper Sleeve' },
		'Promo-LP': {
			sides: 2,
			format: ['12"-Vinyl, 33 1/3 rpm'],
			mbmedium: '12" Vinyl',
			mbpackaging: 'Cardboard/Paper Sleeve',
		},
		'Doppel-LP': {
			sides: 2,
			format: ['12"-Vinyl, 33 1/3 rpm'],
			mbmedium: '12" Vinyl',
			mbpackaging: 'Cardboard/Paper Sleeve',
		},
		'3-LP': { sides: 2, format: ['12"-Vinyl, 33 1/3 rpm'], mbmedium: '12" Vinyl', mbpackaging: 'Cardboard/Paper Sleeve' },
		'3-Bild-LP-Schuber': { sides: 2, format: ['12"-Vinyl, 33 1/3 rpm'], mbmedium: '12" Vinyl', mbpackaging: 'Box' },
		'5-LP-Box': { sides: 2, format: ['12"-Vinyl, 33 1/3 rpm'], mbmedium: '12" Vinyl', mbpackaging: 'Box' },
		'6-LP-Box': { sides: 2, format: ['12"-Vinyl, 33 1/3 rpm'], mbmedium: '12" Vinyl', mbpackaging: 'Box' },
		MC: { sides: 2, format: ['Musik-Cassette'], mbmedium: 'Cassette', mbpackaging: 'Cassette Case' },
		'Promo-MC': { sides: 2, format: ['Musik-Cassette'], mbmedium: 'Cassette', mbpackaging: 'Cassette Case' },
		'Doppel-MC': { sides: 2, format: ['Musik-Cassette'], mbmedium: 'Cassette', mbpackaging: 'Cassette Case' },
		'Doppel-MC-Schuber': { sides: 2, format: ['Musik-Cassette'], mbmedium: 'Cassette', mbpackaging: 'Box' },
		'3-MC-Schuber': { sides: 2, format: ['Musik-Cassette'], mbmedium: 'Cassette', mbpackaging: 'Box' },
		'4-MC-Box': { sides: 2, format: ['Musik-Cassette'], mbmedium: 'Cassette', mbpackaging: 'Box' },
		CD: { sides: 1, format: ['Audio CD', 'Audio-CD'], mbmedium: 'CD', mbpackaging: 'Jewel case' },
		'Digipak-CD': { sides: 1, format: ['Audio CD', 'Audio-CD'], mbmedium: 'CD', mbpackaging: 'Digipak' },
		'Digipak-Doppel-CD': { sides: 1, format: ['Audio CD', 'Audio-CD'], mbmedium: 'CD', mbpackaging: 'Digipak' },
		'Doppel-CD': { sides: 1, format: ['Audio CD', 'Audio-CD'], mbmedium: 'CD', mbpackaging: 'Jewel case' },
		'Doppel-CD-Schuber': { sides: 1, format: ['Audio CD', 'Audio-CD'], mbmedium: 'CD', mbpackaging: 'Box' },
		'Doppel-CD-Box': { sides: 1, format: ['Audio CD', 'Audio-CD'], mbmedium: 'CD', mbpackaging: 'Box' },
		'3-CD': { sides: 1, format: ['Audio CD', 'Audio-CD'], mbmedium: 'CD', mbpackaging: 'Jewel case' },
		'3-CD-Schuber': { sides: 1, format: ['Audio CD', 'Audio-CD'], mbmedium: 'CD', mbpackaging: 'Box' },
		'3-CD-Box': { sides: 1, format: ['Audio CD', 'Audio-CD'], mbmedium: 'CD', mbpackaging: 'Box' },
		'Audio-Dateien': { sides: 1, format: ['Audio-Dateien'], mbmedium: 'Digital Media', mbpackaging: 'None' },
		Stream: { sides: 1, format: ['Audio-Dateien'], mbmedium: 'Digital Media', mbpackaging: 'None' },
	};

	/** @type {*} Array mit Einträgen welche nicht als Crewmitglied gewertet werden */
	const blacklist = ['Studio EUROPA', 'Tonstudio Braun', 'Bastei-Verlag'];

	/** @type {*} Object zum mappen von ausgeschriebenen Monatsnamen zur Zahl */
	const months = new Map([
		['Januar', '1'],
		['Februar', '2'],
		['März', '3'],
		['April', '4'],
		['Mai', '5'],
		['Juni', '6'],
		['Juli', '7'],
		['August', '8'],
		['September', '9'],
		['Oktober', '10'],
		['November', '11'],
		['Dezember', '12'],
	]);

	const notAudioWork = ['Nach dem Roman von', 'Vorlage', 'nach dem Jugendbuch von'];

	const episode = { ...createCrew(), actors: collectActors(), releaseinfos: getReleaseInfos() };

	const websiteInfos = {
		Artists: getArtistsForUI(),
		Additionals: [...addAdditionalInformation()],
		Labels: [...episode.releaseinfos.labels],
	};

	const tableNames = {
		'tbl-Available-Artists': 'Verfügbare Künstler',
		'tbl-Available-Labels': 'Verfügbare Labels',
		'tbl-Seeding-Artists': 'Künstler für Musicbrainz',
		'tbl-Seeding-Labels': 'Labels für Musicbrainz',
		'tbl-Seeding-Additionals': 'Zusätzliche Infos für Musicbrainz',
		'tbl-Importer-MainButtons': 'Buttons für Musicbrainz',
	};
	const additionalsIdMap = {
		'Veröffentlichungs Name': 'tr-ad-relName',
		'Veröffentlichungsgruppen Nane': 'tr-ad-relGrpName',
		'Serien Nane': 'tr-ad-serieName',
		Folgennummer: 'tr-ad-episodeNr',
		'Veröffentlichungs Datum': 'tr-ad-releaseDate',
		Verpackung: 'tr-ad-packaging',
		'Medium Art': 'tr-ad-mediumType',
		'Medium Anzahl': 'tr-ad-mediumCount',
	};
	// #endregion Constants

	// #region Funktionen zum sammeln von Seiten Infos

	function createCrew() {
		let fullCrew = collectCrew();
		let crew = [];
		let booktemplate = [];
		let ret = {};
		fullCrew.map((member) => {
			if (notAudioWork.includes(member.siteJob)) {
				booktemplate.push(member);
			} else {
				crew.push(member);
			}
		});
		if (crew.length) {
			ret['crew'] = [...crew];
		}
		if (booktemplate.length) {
			ret['notForAudioProduction'] = [...booktemplate];
		}
		return ret;
	}

	/**
	 * @description Erstellt ein Objekt mit allen relevanten Beteiligten und deren Aufgaben an der Veräffentlichung
	 * @author Eichi76
	 * @date 2025-03-09
	 * @returns {*} Objekt mit allen relevanten Crewmitglieder
	 */
	function collectCrew() {
		let joblist = [];
		Array.from(qsa('.info-line-container > .info-line:not(.tabled), .crew-set')).map((e) => {
			let currentLine = e.innerText.split(/[\n•]/);
			currentLine.forEach((line) => {
				line = line.trim();
				let lineJobIndexes = [];
				Object.keys(jobsObject).forEach((job) => {
					let lineJobs = {};
					if (new RegExp(String.raw`${job}\W`).test(line)) {
						lineJobs = {
							index: line.search(job),
							length: job.length,
							lastIndex: line.search(job) + job.length,
							job: job,
						};

						lineJobIndexes.push(lineJobs);
					}
				});
				if (lineJobIndexes.length > 0) {
					//lineJobIndexes.sort((b, a) => b.index - a.index);
					lineJobIndexes = arraySort(lineJobIndexes, 'index');
					let jobArtist = { jobs: [], artists: '' };
					lineJobIndexes.forEach((key, index) => {
						if (lineJobIndexes.length > index + 1) {
							let between = line.slice(lineJobIndexes[index].lastIndex, lineJobIndexes[index + 1].index).trim();
							if (between === 'und' || between === ',' || between === '&') {
								jobArtist.jobs.push(key.job);
							} else {
								jobArtist.jobs.push(key.job);
								jobArtist.artists = between;
								joblist.push(jobArtist);
								jobArtist = { jobs: [], artists: [] };
							}
						} else {
							jobArtist.jobs.push(key.job);
							jobArtist.artists = line.slice(lineJobIndexes[index].lastIndex).trim();
							joblist.push(jobArtist);
						}
					});
				}
			});
		});
		return createCrew(cleanjoblist());

		/**
		 * @description Erstellt ein Array mit allen relevanten gefundenen Crewmitgliedern für die Episode
		 * @author Eichi76
		 * @date 2025-03-10
		 * @returns {*}  Array aller Crewmitglieder
		 */
		function createCrew() {
			let members = [];
			joblist.forEach((jobindex) => {
				jobindex.jobs.forEach((job) => {
					jobindex.artists.forEach((artist) => {
						if (!blacklist.includes(artist)) {
							let member = {};
							let add = true;
							member = structuredClone(jobsObject[job]);
							member.mb['name'] = artist.trim();
							member['siteJob'] = job;
							members.forEach((element) => {
								if (
									element.mb.linktype + element.mb.name === member.mb.linktype + member.mb.name ||
									member.mb.linktype == 'Nothing'
								) {
									add = false;
								}
							});
							if (add) {
								members.push(member);
							}
						}
					});
				});
			});
			return arraySort(members, 'id');
		}

		/**
		 * @description Söubert die Artisten von unnötigen Zeichen
		 * @author Eichi76
		 * @date 2025-03-10
		 * @param {*} joblist
		 * @returns {*} gesäubertes Joblist Array
		 */
		function cleanjoblist() {
			let array = [];
			array = Array.from(joblist).map((e) => {
				e.artists = e.artists.replaceAll(/(\(.*?\))/g, '').trim();
				e.artists = e.artists.replaceAll(/[:•]/g, '').trim();

				e.artists = e.artists.split(/, +| und +/).map((f) => {
					return f.trim();
				});
				return e;
			});

			return array;
		}
	}

	/**
	 * @description Erstellt ein Objekt mit allen bekannten Rollen/Schauspieler an der Veräffentlichung
	 * @author Eichi76
	 * @date 2025-03-05
	 * @returns {*} Objekt mit allen bekannten Schauspielern und deren Rolle der Veröffentlichung
	 */
	function collectActors() {
		let actors = [];
		[...qsa('tr', qs('table.release-cast-list'))].map((tr) => {
			let newNode = tr.cloneNode(true);
			let roleName = qs('.role', tr).innerText;
			if (!qs('.name > i', newNode) && qs('.name > i', newNode)?.innerText != 'unbekannt') {
				let actor = structuredClone(jobsObject.Spoken_vocals);

				//actor = { ...jobsObject.Spoken_vocals };

				let footnote = qs('.footnote-number', newNode);
				if (footnote) {
					footnote.parentNode.removeChild(footnote);
				}
				actor.mb.attributesTypes[0].text = roleName;
				if (qs('.literal > span', newNode)) {
					actor['creditedAs'] = cleanString(qs('.literal > span', newNode)?.innerText);
					qs('.literal', newNode).parentNode.removeChild(qs('.literal', newNode));
				}
				actor.mb.name = qs('.name', newNode).innerText.trim();
				actors.push(actor);
			}
		});
		return actors;
	}

	/**
	 * @description Fügt alle Verfügbare Artisten der Episode zusammen
	 * @author Eichi76
	 * @date 2025-03-10
	 * @param {*} heading der heading Bereich der Seite
	 * @param {*} serieName Serienname
	 * @returns {*}  Array mit Artisten
	 */
	function getArtists(heading, serieName) {
		let artists = [];
		if (qs('.artist', heading).innerText.trim()) {
			let name = qs('.artist', heading).innerText.trim();
			let artist = { type: 'artist', name: name, artist: { mame: name } };
			artists.push(artist);
		}
		if (serieName) {
			let serie = { type: 'serieName', name: serieName, artist: { mame: serieName } };
			artists.push(serie);
		}
		return artists;
	}

	/**
	 * @description Aufteilung des Titels in Serienname, Nr. und Titel
	 * @author Eichi76
	 * @date 2025-03-10
	 * @param {*} title Title des Hörspiels
	 * @returns {*}  Groups mit aufgeteiltem Titel
	 */
	function getSerieInfo(title) {
		switch (true) {
			case /^.+ \d+: .+$/.test(title):
				return /^(?<serieName>.+) (?<episodeNr>\d+): (?<episodeTitle>.+)$/.exec(title).groups;
			case /^.+: .+$/.test(title):
				return /^(?<serieName>.+): (?<episodeTitle>.+)$/.exec(title).groups;
			case /^.+$/.test(title):
				return /^(?<episodeTitle>.+)$/.exec(title).groups;
		}
	}

	/**
	 * @description Sammelt die Labels der Seite
	 * @author Eichi76
	 * @date 2025-03-10
	 * @param {*} heading
	 * @returns {*} Gibt ein Array mit Labels und deren Katalognummern zurück
	 */
	function getLabels(heading) {
		let labels = [];
		let label = {
			name: qs('.catalog > .label', heading).innerText.trim(),
			catalog_number: /.*?(Box|MC|LP|CD|Stream) (?<catalog>.*?) \(.*/.exec(qs('.catalog', heading).innerText)
				? /.*?(Box|MC|LP|CD|Stream) (?<catalog>.*?) \(.*/.exec(qs('.catalog', heading).innerText.trim()).groups.catalog
				: '',
			mbid: '',
		};
		labels.push(label);
		return labels;
	}

	/**
	 * @description Gibt ein Array mit deM Medium Typ zurück
	 * @author Eichi76
	 * @date 2025-03-10
	 * @returns {*}  Mediumtyp Array
	 */
	function gettypes() {
		return Array.from(qsa('#heading-details > .release-info .catalog')).map((e) => {
			let types = e.cloneNode(true);
			types.removeChild(qs('a', types));
			return types.innerHTML.trim().split(' ')[0];
		})[0];
	}

	/**
	 * @description Gibt einen verifizierten Barcode zurück, wenn vorhanden
	 * @author Eichi76
	 * @date 2025-03-10
	 * @param {*} labels
	 * @returns {String} String eines verifizierten Barcode
	 */
	function getBarcode(labels) {
		let ret;
		labels.map((label) => {
			if (validbarcode(label?.catalog_number.trim().replaceAll(/[\W+-]/g, ''))) {
				ret = label?.catalog_number.trim().replaceAll(/[\W+-]/g, '');
			}
		});

		Array.from(qsa('.info-line.tabled')).map((e) => {
			if (e.firstChild.innerText.indexOf('Katalognummer') > -1) {
				Array.from(qsa('a', e.firstChild.nextSibling)).map((a) => {
					let barcode = a.innerText.trim().replaceAll(/[\W+-]/g, '');
					if (validbarcode(barcode)) {
						ret = barcode;
					}
				});
			}
		});

		return ret;
	}

	/**
	 * @description Erstellt ein Event-Object mit dem gefundenen Datum zur überabe an MB
	 * @author Eichi76
	 * @date 2025-03-10
	 * @param {*} date
	 * @returns {*}  Event Objekt
	 */
	function getReleaseDate(date) {
		if (/^\d{1,2}\. [\u00C0-\u017FA-Za-z]+ \d{4}$/.test(date)) {
			let { day, month, year } = /^(?<day>\d{1,2})\. (?<month>[\u00C0-\u017FA-Za-z]+) (?<year>\d{4})$/.exec(date).groups;
			let dateObject = {
				date: zipObject(['day', 'month', 'year'], [day, months.get(month), year]),
				country: 'de',
			};
			return { events: [dateObject] };
		}
		if (/^[\u00C0-\u017FA-Za-z]+ \d{4}$/.test(date)) {
			let { month, year } = /^(?<month>[\u00C0-\u017FA-Za-z]+) (?<year>\d{4})$/.exec(date).groups;
			let dateObject = { date: zipObject(['month', 'year'], [months.get(month), year]), country: 'de' };
			return { events: [dateObject] };
		}
		if (/^\d{4}$/.test(date)) {
			let { year } = /^(?<year>\d{4})$/.exec(date).groups;
			let dateObject = { date: zipObject(['year'], [year ?? '']), country: 'de' };
			return { events: [dateObject] };
		}
		return { events: [{ country: 'de' }] };
	}

	/**
	 * @description Sucht nach zusätzlichen Daten über das Release
	 * @author Eichi76
	 * @date 2025-03-10
	 * @returns {*}  Objekt mit zusätzlichen Informationen
	 */
	function getAdditionalInfos() {
		let elements = {};
		Array.from(qsa('.nonbreak')).map((e) => {
			let infoArray = e.innerText.split(': ');
			if (!blacklist.includes(infoArray[1])) {
				if (additionalInfos[infoArray[0]] == 'releaseDate') {
					elements['releaseDateEstimated'] = 0;
					if (infoArray[1].indexOf('ca.') > -1) {
						elements['releaseDateEstimated'] = 1;
					}
					infoArray[1] = getReleaseDate(infoArray[1].trim().replaceAll('ca. ', ''));
				}
				elements[additionalInfos[infoArray[0]]] = infoArray[1];
			}
		});

		return elements;
	}

	function addAdditionalInformation() {
		let ret = [];
		let releaseDate = {
			releaseDateEstimated: episode.releaseinfos.releaseDateEstimated,
			...episode.releaseinfos.releaseDate,
		};

		if (episode.releaseinfos?.name) {
			ret.push({ reltyp: 'additional', siteJob: 'Veröffentlichungs Name', name: episode.releaseinfos.name });
		}
		if (episode.releaseinfos?.name) {
			ret.push({ reltyp: 'additional', siteJob: 'Veröffentlichungsgruppen Nane', name: '' });
		}
		if (episode.releaseinfos?.serieName) {
			ret.push({ reltyp: 'additional', siteJob: 'Serien Nane', name: episode.releaseinfos.serieName });
		}
		if (episode.releaseinfos?.serieName) {
			ret.push({ reltyp: 'additional', siteJob: 'Folgennummer', name: episode.releaseinfos.episodeNr });
		}
		if (episode.releaseinfos?.releaseDate) {
			ret.push({ reltyp: 'additional', siteJob: 'Veröffentlichungs Datum', name: releaseDate });
		}
		if (episode.releaseinfos?.barcode) {
			ret.push({ reltyp: 'additional', siteJob: 'Barcode', name: episode.releaseinfos.barcode });
		}
		if (episode.releaseinfos?.mediumsinfo.mbpackaging) {
			ret.push({ reltyp: 'additional', siteJob: 'Verpackung', name: episode.releaseinfos?.mediumsinfo.mbpackaging });
		}
		if (episode.releaseinfos?.mediumsinfo.mbmedium) {
			ret.push({ reltyp: 'additional', siteJob: 'Medium Art', name: episode.releaseinfos?.mediumsinfo.mbmedium });
		}
		if (episode.releaseinfos.mediumsinfo.sides && episode.releaseinfos.runtimes) {
			ret.push({
				reltyp: 'additional',
				siteJob: 'Medium Anzahl',
				name: episode.releaseinfos.runtimes.length / episode.releaseinfos.mediumsinfo.sides,
			});
		}
		return ret;
	}

	/**
	 * @description Sucht nach angegebenen Zeiten der Folgen bzw. Seiten des Release
	 * @author Eichi76
	 * @date 2025-03-10
	 * @returns {*}  Array mit allen angegebenen Laufzeiten
	 */
	function getRuntimes() {
		let runtimes;
		Array.from(qsa('.info-line.tabled')).map((e) => {
			if (e.firstChild.innerText.indexOf('Spielzeit:') > -1) {
				runtimes = e.firstChild.nextSibling.innerText.replace(/\u00a0/g, ' ').trim();
				if (/\(.*?\)/.test(runtimes)) {
					runtimes = /\((?<mins>.*?)\)/.exec(runtimes).groups['mins'].split(' • ').join('');
				}
				runtimes = runtimes.replace(/ min\.$/g, '').split(' min.');
			}
		});
		return runtimes;
	}

	function getReleaseUrl() {
		let url = new URL(window.location);
		console.log('url', url);
		return `${url.origin + url.pathname + url.search.split('&')[0]}`;
	}

	/**
	 * @description Sammelt Daten für das Releaseinfo Objekt
	 * @author Eichi76
	 * @date 2025-03-10
	 * @returns {*}  Releaseinfo Objekt
	 */
	function getReleaseInfos() {
		let releaseinfos = {};
		let heading = qs('#heading-details');
		let title = qs('.title', heading)
			.innerText.trim()
			.replace(/\((\d+)\)/, '$1:');
		releaseinfos = {
			...getSerieInfo(title),
			releaseUrl: getReleaseUrl(),
			name: title,
			labels: getLabels(heading),
			artist_credit: {
				names: getArtists(heading, releaseinfos?.serieName),
			},
			runtimes: getRuntimes(),
			mediumsinfo: {
				...mediumsTyps[gettypes()],
			},
			...getAdditionalInfos(),
		};
		releaseinfos['barcode'] = getBarcode(releaseinfos['labels']);

		return releaseinfos;
	}

	// #endregion Funktionen zum sammeln von Seiten Infos

	// #region Website UI

	async function createBasicUI() {
		nameToMBIDCache.load();

		const mbImporter = createElement('div', { id: 'mbImporter' });
		mbImporter.hidden = true;
		const importerContainer = createElement('div', { id: 'importerContainer' });
		const containerButton = createElement('button', {});
		const icon = document.createElement('img');
		icon.src = '//musicbrainz.org/favicon.ico';
		let containerText = createElement('span', { id: 'containerText' }, 'MUSICBRAINZ IMPORTER ÖFFNEN');
		containerButton.append(icon, containerText);
		containerButton.addEventListener('click', () => {
			if (mbImporter.hidden) {
				mbImporter.hidden = false;
				containerText.innerText = 'MUSICBRAINZ IMPORTER SCHLIESSEN';
			} else {
				mbImporter.hidden = true;
				containerText.innerText = 'MUSICBRAINZ IMPORTER ÖFFNEN';
			}
		});
		importerContainer.appendChild(containerButton);
		const mbImporter_tables = createTables();
		mbImporter_tables.forEach((table) => {
			mbImporter.appendChild(table);
		});

		for (const [tableType, tableRowObjects] of Object.entries(websiteInfos)) {
			if (tableRowObjects && Array.isArray(tableRowObjects)) {
				for (const tableRowObject of tableRowObjects) {
					if (tableType === 'Labels') {
						tableRowObject['reltyp'] = 'label';
					}
					const tableRow = await createTableRow(tableType, tableRowObject);
					if (tableRowObjects.length > 1 && tableType !== 'Additionals') {
						qs(`#tb-Available-${tableType}`, mbImporter).appendChild(tableRow);
					} else {
						if (tableRowObject.siteJob === 'Veröffentlichungs Datum' && tableRowObject.name.releaseDateEstimated === 1) {
							let spacialRow = createEstimatedDate();
							qs(`#tb-Seeding-${tableType}`, mbImporter).appendChild(spacialRow);
						}
						qs(`#tb-Seeding-${tableType}`, mbImporter).appendChild(tableRow);
					}
				}
			}
		}
		const controlBtns = await createTableRow('MainButtons', {});
		let importerButtons = qs('#tb-Importer-MainButtons', mbImporter);
		importerButtons.append(controlBtns);

		//await qs('.page-kartei-nav').after(mbImporter);
		importerContainer.appendChild(mbImporter);
		await qs('.page-kartei-nav').after(importerContainer);
		showHideButtons();

		function createEstimatedDate() {
			let tr = document.createElement('tr');
			let td = document.createElement('td');
			let button = document.createElement('button');
			let span = document.createElement('span');

			tr.id = 'tr-ad-relDateEstimated';

			td.colSpan = 2;
			td.setAttribute('align', 'center');
			td.style = 'background-color: red; color: white;';

			span.innerText = `Das Datum ist nur geschätzt und wird nicht an Musicbrainz übertragen. Bitte bestätigen sie das Datum wenn es übertragen werden soll!\n`;
			span.style = 'font-weight:600;';

			button.innerText = 'Datum bestätigen';
			button.addEventListener('click', (event) => {
				let trToDelete = event.target.parentNode.parentNode;
				trToDelete.parentNode.removeChild(trToDelete);
				episode.releaseinfos.releaseDateEstimated = 0;
				websiteInfos.Additionals.forEach((item) => {
					if (item.siteJob === 'Veröffentlichungs Datum') {
						item.name.releaseDateEstimated = 0;
					}
				});
			});

			td.appendChild(span);
			td.appendChild(button);
			tr.appendChild(td);
			return tr;
		}

		function createTables() {
			const uiTableIds = [
				'tbl-Available-Artists',
				'tbl-Available-Labels',
				'tbl-Seeding-Artists',
				'tbl-Seeding-Labels',
				'tbl-Seeding-Additionals',
				'tbl-Importer-MainButtons',
			];
			let uiTables = Array.from(
				uiTableIds.map((tableId) => {
					return createTable(tableId);
				})
			);
			return uiTables;
		}

		function createTable(tableId) {
			const table = createElement('table', { id: tableId });
			const tableStructure = [
				createElement('caption', {}, tableNames[tableId]),
				createTableHead(),
				createElement('tbody', { id: `tb-${tableId.slice(4)}` }),
			];
			tableStructure.forEach((element) => {
				table.appendChild(element);
			});

			return table;

			function createTableHead() {
				const tableType = tableId.split('-')[2];
				const tableHeaders = {
					Artists: [
						{ attributes: { style: 'width:25%' } },
						{ attributes: { style: 'width:25%' } },
						{ attributes: { style: 'width:30%' } },
						{ attributes: { style: 'width:4%' } },
						{ attributes: { style: 'width:4%' } },
						{ attributes: { style: 'width:4%' } },
						{ attributes: { style: 'width:4%' } },
					],
					Labels: [
						{ attributes: { style: 'width:20%' } },
						{ attributes: { style: 'width:30%' } },
						{ attributes: { style: 'width:10%' } },
						{ attributes: { style: 'width:20%' } },
						{ attributes: { style: 'width:4%' } },
						{ attributes: { style: 'width:4%' } },
						{ attributes: { style: 'width:4%' } },
						{ attributes: { style: 'width:4%' } },
					],
					Additionals: [
						{ attributes: { style: 'width:50%' } },
						{ attributes: { style: 'width:50%' } },
						//{ attributes: { style: 'width:10%' } },
						//{ attributes: { style: 'width:50%' } },
					],
					MainButtons: [{ attributes: { style: 'width:50%' } }, { attributes: { style: 'width:50%' } }],
				};
				const thead = createElement('thead', { id: `th-${tableId.slice(4)}` });
				const tr = createElement('tr', { id: `tr-${tableId.slice(4)}-head` });
				tableHeaders[tableType].forEach((th) => {
					const newTh = createElement('th', th.attributes);
					tr.appendChild(newTh);
				});
				thead.appendChild(tr);
				return thead;
			}
		}

		async function createTableRow(tableType, rowObject) {
			const row = createElement('tr', {});
			if (tableType === 'Additionals') {
				row.id = additionalsIdMap[rowObject.siteJob] ? additionalsIdMap[rowObject.siteJob] : rowObject.siteJob;
			}
			const tableContents = {
				Artists: [
					{ attributes: { class: 'right' }, text: rowObject.siteJob },
					{ attributes: {}, text: rowObject.name },
					{ attributes: {}, text: '', includeElement: 'mbInput' },
					{ attributes: {}, text: '', includeElement: 'buttonToSeed' },
					{ attributes: {}, text: '', includeElement: 'buttonFromSeed' },
					{ attributes: {}, text: '', includeElement: 'buttonPosUp' },
					{ attributes: {}, text: '', includeElement: 'buttonPosDown' },
				],
				Labels: [
					{ attributes: { class: 'right' }, text: rowObject.name },
					{ attributes: {}, text: '', includeElement: 'mbInput' },
					{ attributes: {}, text: 'Katalog:' },
					{ attributes: {}, text: '', includeElement: 'textInput' },
					{ attributes: {}, text: '', includeElement: 'buttonToSeed' },
					{ attributes: {}, text: '', includeElement: 'buttonFromSeed' },
					{ attributes: {}, text: '', includeElement: 'buttonPosUp' },
					{ attributes: {}, text: '', includeElement: 'buttonPosDown' },
				],
				Additionals: [
					{ attributes: { class: 'right' }, text: rowObject.siteJob },
					{ attributes: {}, text: rowObject.name },
				],
				MainButtons: [
					{ attributes: {}, text: '', includeElement: 'buttonForSeeding' },
					{ attributes: {}, text: '', includeElement: 'buttonCopyCredits' },
				],
			};
			for (const tdObject of tableContents[tableType].values()) {
				const td = await createTd(tdObject);
				row.appendChild(td);
			}
			return row;

			async function createTd(td) {
				const newTd = createElement('td', td.attributes, td.text);
				if (td?.includeElement === 'mbInput') {
					const fromCache = await loadFromCache(rowObject);
					let initialMappingValue;
					if (fromCache.mbid) {
						initialMappingValue = [fromCache.type, fromCache.mbid].join('/');
					}
					const mbidInput = await createMBIDInput('', [fromCache.type], initialMappingValue);

					// update cache and importer form if the user pasted an MBID mapping
					mbidInput.addEventListener('mbid-input', async (event) => {
						const mbid = event.detail.id;
						nameToMBIDCache.set([fromCache.type, fromCache.name], mbid);
						nameToMBIDCache.store();
						nameToMBIDCache.load();
					});
					newTd.appendChild(mbidInput);
				}
				if (td?.includeElement === 'textInput') {
					const input = createElement('input', { type: 'text', value: rowObject?.catalog_number });
					newTd.appendChild(input);
				}
				if (td.includeElement && td.includeElement.indexOf('button') > -1) {
					const button = createElement('button');
					if (td.includeElement.indexOf('ToSeed') > -1) {
						button.className = 'toSeed';
						button.innerText = '+';
						button.addEventListener('click', (event) => {
							let source = event.target.parentNode.parentNode;
							let type = source.id.split('-');
							let target = qs(`#tb-Seeding-${capitalizeFirstLetter(type[2])}`);
							target.appendChild(source);
							showHideButtons();
						});
					}
					if (td.includeElement.indexOf('FromSeed') > -1) {
						button.className = 'fromSeed';
						button.innerText = '-';
						button.addEventListener('click', (event) => {
							let source = event.target.parentNode.parentNode;
							let type = source.id.split('-');
							let target = qs(`#tb-Available-${capitalizeFirstLetter(type[2])}`);
							target.appendChild(source);
							showHideButtons();
						});
					}
					if (td.includeElement.indexOf('PosUp') > -1) {
						button.className = 'posUp';
						button.innerText = '\u2191';
						button.addEventListener('click', (event) => {
							let source = event.target.parentNode.parentNode;
							let target = event.target.parentNode.parentNode.previousSibling;
							source.after(target);
							showHideButtons();
						});
					}
					if (td.includeElement.indexOf('PosDown') > -1) {
						button.className = 'posDown';
						button.innerText = '\u2193';
						button.addEventListener('click', (event) => {
							let source = event.target.parentNode.parentNode;
							let target = event.target.parentNode.parentNode.nextSibling;
							target.after(source);
							showHideButtons();
						});
					}
					if (td.includeElement.indexOf('ForSeeding') > -1) {
						const icon = document.createElement('img');
						icon.src = '//musicbrainz.org/favicon.ico';
						button.append(icon, currentLangObject['seedbutton'].text);
						button.title = currentLangObject['seedbutton'].title;
						button.id = 'mbseed-button';
						button.addEventListener('click', (event) => {
							const release = createReleaseObj();
							const form = createReleaseSeederForm(release);
							event.target.parentNode.appendChild(form);
							form.submit();
						});
					}
					if (td.includeElement.indexOf('buttonCopyCredits') > -1) {
						button.type = 'button';
						button.title = currentLangObject['copyButton'].title;
						button.innerText = currentLangObject['copyButton'].text;
						button.addEventListener('click', (event) => {
							//let copyString = episode['actors'].map((credit) => `${credit.roleName ?? ''} - ${credit.artist}`).join('\n');
							let copyString = '';
							if (!event.shiftKey) {
								copyString = episode.actors
									.map((credit) => `${credit.mb.attributesTypes[0].text ?? ''} - ${credit.mb.name}`)
									.join('\n');
							}
							if (event.shiftKey) {
								//copyString = JSON.stringify(jsonFromCrew());
								const crewArray = [];

								episode.crew.forEach((obj) => {
									//console.log('obj', obj);
									crewArray.push(obj.mb);
								});
								episode.actors.forEach((obj) => {
									//console.log('obj', obj);
									crewArray.push(obj.mb);
								});
								if (crewArray.length) {
									crewArray.push({ importUrl: episode.releaseinfos.releaseUrl });
								}
								copyString = JSON.stringify(crewArray);
							}
							console.log(copyString);
							navigator.clipboard?.writeText(copyString);
							button.innerText = currentLangObject['copyButton'].successText;
						});
					}
					newTd.appendChild(button);
				}
				if (rowObject.siteJob === 'Veröffentlichungs Datum' && td.text !== 'Veröffentlichungs Datum') {
					newTd.innerText = `${
					rowObject.name.events[0].date.day ? rowObject.name.events[0].date.day.padStart(2, '0') + '.' : ''
				}${rowObject.name.events[0].date.month ? rowObject.name.events[0].date.month.padStart(2, '0') + '.' : ''}${
					rowObject.name.events[0].date.year ? rowObject.name.events[0].date.year : ''
				}`;
				}
				if (rowObject.siteJob === 'Veröffentlichungs Name' && td.text !== 'Veröffentlichungs Name') {
					const secondTd = document.createElement('textarea');
					secondTd.style = 'width:100%;';
					secondTd.value = td.text;
					newTd.innerText = '';
					newTd.appendChild(secondTd);
				}
				if (rowObject.siteJob === 'Veröffentlichungsgruppen Nane' && td.text !== 'Veröffentlichungsgruppen Nane') {
					let rlgObject = { reltyp: 'release-group', name: episode.releaseinfos.name, mbid: '' };
					const fromCache = await loadFromCache(rlgObject);
					let initialMappingValue;
					if (fromCache.mbid) {
						initialMappingValue = [fromCache.type, fromCache.mbid].join('/');
					}
					const mbidInput = await createMBIDInput('', [fromCache.type], initialMappingValue);

					// update cache and importer form if the user pasted an MBID mapping
					mbidInput.addEventListener('mbid-input', async (event) => {
						const mbid = event.detail.id;
						nameToMBIDCache.set([fromCache.type, fromCache.name], mbid);
						nameToMBIDCache.store();
						nameToMBIDCache.load();
					});
					newTd.appendChild(mbidInput);
				}
				if (rowObject.siteJob === 'Serien Nane' && td.text !== 'Serien Nane') {
					let seriesObject = { reltyp: 'series', name: episode.releaseinfos.serieName, mbid: '' };
					const fromCache = await loadFromCache(seriesObject);
					let initialMappingValue;
					if (fromCache.mbid) {
						initialMappingValue = [fromCache.type, fromCache.mbid].join('/');
					}
					const mbidInput = await createMBIDInput('', [fromCache.type], initialMappingValue);
					newTd.innerText = '';

					// update cache and importer form if the user pasted an MBID mapping
					mbidInput.addEventListener('mbid-input', async (event) => {
						const mbid = event.detail.id;
						nameToMBIDCache.set([fromCache.type, fromCache.name], mbid);
						nameToMBIDCache.store();
						nameToMBIDCache.load();
					});
					newTd.appendChild(mbidInput);
				}
				if (rowObject.siteJob === 'Folgennummer' && td.text !== 'Folgennummer') {
					const secondTd = document.createElement('input');
					secondTd.value = td.text;
					newTd.innerText = '';
					newTd.appendChild(secondTd);
				}
				return newTd;
			}
		}

		function createReleaseObj() {
			let ret = {
				name: qs('#tr-ad-relName > td > textarea').value,
				artist_credit: collectArtistToSeed(),
				type: ['Other', 'Audio drama'],
				labels: collectLabelsToSeed(),
				language: 'deu',
				script: 'Latn',
				status: 'Official',
				mediums: generateMediums(),
				urls: [
					{
						url: episode.releaseinfos['releaseUrl'],
						link_type: urlTypeIds['discography entry'],
					},
				],
				edit_note: buildEditNote(`Imported Audio drama from ${episode.releaseinfos['releaseUrl']}`),
			};
			let events = collectEventsToSeed();
			if (events) {
				ret['events'] = events;
			}
			if (episode.releaseinfos.barcode) {
				ret['barcode'] = episode.releaseinfos.barcode;
			}
			if (episode.releaseinfos.mediumsinfo.mbpackaging) {
				ret['packaging'] = episode.releaseinfos.mediumsinfo.mbpackaging;
			}
			let relGrpMBID = qs('#tr-ad-relGrpName > td > input').dataset.mbid;
			if (relGrpMBID !== undefined) {
				ret['release_group'] = relGrpMBID;
			}
			return ret;
			function collectArtistToSeed() {
				let seedingArtistsInputs = qsa('#tb-Seeding-Artists > tr > td > input');
				let ret = [];
				seedingArtistsInputs.forEach((artist, index) => {
					if (artist.value != '') {
						let currArtist = { name: artist.value, artist: { name: artist.value } };
						if (artist.dataset.mbid) {
							currArtist['mbid'] = artist.dataset.mbid;
						}
						if (index < seedingArtistsInputs.length - 1) {
							currArtist['join_phrase'] = ', ';
						}
						ret.push(currArtist);
					}
				});
				return { names: ret };
			}
			function collectEventsToSeed() {
				let ret = false;
				if (episode.releaseinfos.releaseDateEstimated === 0) {
					ret = episode.releaseinfos.releaseDate.events;
				}
				return ret;
			}
			function collectLabelsToSeed() {
				let seedingLabelsInputs = qsa('#tb-Seeding-Labels > tr');
				let ret = [];
				seedingLabelsInputs.forEach((label) => {
					let labelInputs = qsa('td > input', label);
					if (labelInputs[0].value != '' || labelInputs[1].value != '') {
						let currLabel = {};
						if (labelInputs[0].value) {
							currLabel['name'] = labelInputs[0].value;
						}
						if (labelInputs[0].dataset.mbid) {
							currLabel['mbid'] = labelInputs[0].dataset.mbid;
						}
						if (labelInputs[1].value != '') {
							currLabel['catalog_number'] = labelInputs[1].value;
						}
						ret.push(currLabel);
					}
				});
				return ret;
			}
			function generateMediums(tracksPerMedium = []) {
				let mediums = [];
				if (tracksPerMedium.length === 0) {
					for (
						let index = 0;
						index < episode.releaseinfos.runtimes.length / episode.releaseinfos.mediumsinfo.sides;
						index++
					) {
						tracksPerMedium.push(episode.releaseinfos.mediumsinfo.sides);
					}
				}
				let trackCountgiven = 0;
				tracksPerMedium.forEach((item) => {
					trackCountgiven += item;
				});
				let equalTrackCount = trackCountgiven === episode.releaseinfos.runtimes.length;
				let totalCounter = 0;
				tracksPerMedium.forEach((medium) => {
					let tracks = [];
					for (let index = 0; index < medium; index++) {
						let track = {
							name: `${episode.releaseinfos.episodeTitle}, ${
							episode.releaseinfos.mediumsinfo.sides === 1 ? 'Kapitel' : 'Seite'
						} ${totalCounter + 1}`,
							number: index + 1,
						};
						if (equalTrackCount) {
							track['length'] = episode.releaseinfos.runtimes[totalCounter];
						}
						totalCounter++;
						tracks.push(track);
					}
					let mediumObj = { format: episode.releaseinfos.mediumsinfo.mbmedium, track: tracks };
					mediums.push(mediumObj);
				});
				return mediums;
			}
		}
	}

	function showHideButtons() {
		let tables = qsa('#mbImporter table tbody');
		tables.forEach((table) => {
			if (!table.hasChildNodes()) {
				table.parentNode.hidden = true;
			} else {
				table.parentNode.hidden = false;
			}
		});

		let av_buttons = qsa('#tb-Available-Artists > tr > td > button,#tb-Available-Labels > tr > td > button');
		let se_buttons = qsa('#tb-Seeding-Artists > tr > td > button,#tb-Seeding-Labels > tr > td > button');
		av_buttons.forEach((button) => {
			if (button.className !== 'toSeed') {
				button.hidden = true;
			} else {
				button.hidden = false;
			}
		});
		se_buttons.forEach((button) => {
			let parentRow = button.parentNode.parentNode;
			if (button.className === 'toSeed') {
				button.hidden = true;
			} else {
				button.hidden = false;
			}

			if (button.className === 'posUp') {
				if (parentRow.parentNode.firstChild == parentRow) {
					button.hidden = true;
				} else {
					button.hidden = false;
				}
			}

			if (button.className === 'posDown') {
				if (parentRow.parentNode.lastChild == parentRow) {
					button.hidden = true;
				} else {
					button.hidden = false;
				}
			}
		});
		setRowIds();
	}

	function setRowIds() {
		let bodies = qsa('#mbImporter > table > tbody:not(#tb-Seeding-Additionals)');
		bodies.forEach((body) => {
			let rows = qsa('tr', body);
			rows.forEach((row, index) => {
				row.id = `tr-${body.id.slice(3)}-${index}`;
			});
		});
	}

	function getArtistsForUI() {
		let artists = [];
		if (episode.crew) {
			episode.crew.forEach((e) => {
				let artist = {};
				if (e.relTyp === 'Writer') {
					artist['reltyp'] = 'artist';
					artist['siteJob'] = e.siteJob;
					artist['name'] = e.mb.name;
					artist['mbid'] = '';

					artists.push(artist);
				}
			});
		}

		if (episode.notForAudioProduction) {
			episode.notForAudioProduction.forEach((e) => {
				let artist = {};
				if (e.relTyp === 'Writer') {
					artist['reltyp'] = 'artist';
					artist['siteJob'] = e.siteJob;
					artist['name'] = e.mb.name;
					artist['mbid'] = '';

					artists.push(artist);
				}
			});
		}

		if (episode.releaseinfos.serieName) {
			let artist = {};
			artist['reltyp'] = 'artist';
			artist['siteJob'] = 'Serienname';
			artist['name'] = episode.releaseinfos.serieName;

			artists.push(artist);
		}
		return artists;
	}
	function createElement(element, options = {}, text = '') {
		let temp = document.createElement(element);
		Object.entries(options).forEach((key) => {
			temp.setAttribute(key[0], key[1]);
		});
		temp.innerText = text;
		return temp;
	}

	/** @param {MB.ArtistCreditSeed} artistCredit */
	async function loadFromCache(infos) {
		let ret = (await loadCachedMBID(infos, infos.reltyp, infos.name)) ?? [];
		return ret;
	}

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
	// #endregion Website UI

	console.log('episode:', episode);
	console.log('websiteInfos', websiteInfos);

	createBasicUI();
	injectStylesheet(styles);

})();
