import { urlTypeIds } from '@kellnerd/musicbrainz-scripts/src/data/release.js';
import { buildEditNote } from '@kellnerd/musicbrainz-scripts/src/editNote.js';
import { qs, qsa } from '@kellnerd/es-utils/dom/select.js';
import { zipObject } from '@kellnerd/es-utils/object/zipObject.js';
import { injectStylesheet } from '@kellnerd/es-utils/dom/create.js';
import { nameToMBIDCache } from '@kellnerd/musicbrainz-scripts/src/nameToMBIDCache.js';
import { createMBIDInput } from '@kellnerd/musicbrainz-scripts/src/inputMBID.js';
import { createReleaseSeederForm } from '@kellnerd/musicbrainz-scripts/src/seeding.js';
console.log('Hörspielforscher triggered');
// TODO: Beim einlesen der Künstler bei "und" aufteilen
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
`;
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
	Spoken_vocals: {
		mb: { name: '', targetType: 'artist', linktype: 'Vocal', attributesTypes: [{ type: 'Spoken_vocals', text: '' }] },
		relTyp: 'Spoken_vocals',
	},
	Illustration: {
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
	'Nach dem Roman von': {
		mb: { name: '', targetType: 'artist', linktype: 'Writer', attributesTypes: [] },
		relTyp: 'Writer',
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
	'Audio-Dateien': { sides: 1, format: ['Audio-Dateien'], mbmedium: 'Digital Media', mbpackaging: 'None' },
	Stream: { sides: 1, format: ['Audio-Dateien'], mbmedium: 'Digital Media', mbpackaging: 'None' },
};

/** @type {*} Array mit Einträgen welche nicht als Crewmitglied gewertet werden */
const blacklist = ['Studio EUROPA', 'Tonstudio Braun'];

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

/** @type {*} Initiale Informationen über das aufgerufene Hörspiel */

const episode = { ...createCrew(), actors: collectActors(), releaseinfos: getReleaseInfos() };

const websiteInfos = {
	Artists: getArtistsForUI(),
	Additionals: [...addAdditionalInformation()],
	Labels: [...episode.releaseinfos.labels],
};

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
						if (between === 'und' || between === ',') {
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
							if (element.mb.linktype + element.mb.name === member.mb.linktype + member.mb.name) {
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

			e.artists = e.artists.split(', ').map((f) => {
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
		default:
			break;
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
	return `${url.origin + url.pathname + url.search}`;
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
	const containerButton = createElement('button', {
		style: 'width: 100%; background-color: green; color: white; border-color: white; border-width: 5px; margin: 4px;',
	});
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
