import { urlTypeIds } from '@kellnerd/musicbrainz-scripts/src/data/release.js';
import { buildEditNote } from '@kellnerd/musicbrainz-scripts/src/editNote.js';
import { nameToMBIDCache } from '@kellnerd/musicbrainz-scripts/src/nameToMBIDCache.js';
import { createHiddenForm } from '@kellnerd/es-utils/dom/form.js';
import { createElement, injectStylesheet } from '@kellnerd/es-utils/dom/create.js';
import { buildEntityURL } from '@kellnerd/musicbrainz-scripts/src/entity.js';
import { qs, qsa } from '@kellnerd/es-utils/dom/select.js';
import { flatten } from '@kellnerd/es-utils/object/flatten.js';
import { zipObject } from '@kellnerd/es-utils/object/zipObject.js';
import { extractEntityFromURL, getEntityTooltip } from '@kellnerd/musicbrainz-scripts/src/entity.js';
import { fetchEntity } from '@kellnerd/musicbrainz-scripts/src/publicAPI.js';
import { toScalar } from '@kellnerd/es-utils/array/scalar.js';
import { kebabToTitleCase } from '@kellnerd/es-utils/string/casingStyle.js';

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

		default:
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

		default:
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

			default:
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
