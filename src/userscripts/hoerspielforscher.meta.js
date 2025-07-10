/** @type {import('@kellnerd/userscript-bundler').EnhancedUserscriptMetadata} */
const metadata = {
	name: 'Hoerspielforscher Musicbrainz Import',
	author: 'Eichi76', // optional, falls back to your GitHub username
	description: 'Importiert Hörspielproduktionen von Hoerspielforschern',
	features: [
		'Erstellt ein Importer Element um Hörspiele von **[Hörspielforscher](https://hoerspielforscher.de/)** in Musicbrainz zu hinzuzufügen',
		'Erlaubt dem Benutzer, permanente Namenszuweisungen zu bestehenden MBIDs des Künstlers/Labels/Veröffentlichungsgruppe/Serie einzugeben.',
		'Erkennt Serie/Folgennummer/Folgenname und erzeugt daraus einen eindeutigen Albumnamen, der geändert werden kann.',
		'Identifiziert die Anzahl der Medien der Veröffentlichung, sofern diese Information auf der Seite verfügbar ist.',
		'(in Planung) Für jedes Medium kann die Anzahl der Titel festgelegt werden, die dann mit beispielhaften Titelnamen an Musicbrainz übergeben werden.',
		'Erstellt einen Button, um die Sprecherrollen in die Zwischenablage zu kopieren, die dann mit **[Kellnerds Voice Actor Credits-Skript](https://github.com/kellnerd/musicbrainz-scripts?tab=readme-ov-file#voice-actor-credits)** eingefügt werden können.',
		'(optional|in Entwickluckung) Kopieren eines JSON Strings der gesamten Crew in die Zwischenablage welches mit **[Kellnerds Voice Actor Credits-Skript](https://github.com/kellnerd/musicbrainz-scripts?tab=readme-ov-file#voice-actor-credits)** eingefügt werden kann',
	],
	match: '*://hoerspielforscher.de/kartei/hoerspiel?detail=*',
};

export default metadata;
