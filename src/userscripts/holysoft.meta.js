/** @type {import('@kellnerd/userscript-bundler').EnhancedUserscriptMetadata} */
const metadata = {
	name: 'Holysoft Musicbrainz Import',
	author: 'Eichi76', // optional, falls back to your GitHub username
	description:
		'Importiert Hörspielproduktionen aus dem Holysoft Shop und erstellt einen String, um die entsprechende Crew bei Musicbrainz hinzuzufügen.',
	features: [
		'Erstellt ein Formular auf der linken Seite unter dem Cover bei Holysoft Produktionen im **[Holysoft-Shop](https://shop.holysoft.de/)**',
		'Erlaubt dem Benutzer, permanente Namenszuweisungen zu bestehenden MBIDs des Künstlers einzugeben.',
		'Erkennt Serie/Folgennummer/Folgenname und erzeugt daraus einen eindeutigen Albumnamen, der geändert werden kann.',
		'Identifiziert die Anzahl der Medien der Veröffentlichung, sofern diese Information auf der Seite verfügbar ist.',
		'Für jedes Medium kann die Anzahl der Titel festgelegt werden, die dann mit beispielhaften Titelnamen an Musicbrainz übergeben werden.',
		'Erstellt einen Button, um die Sprecherrollen in die Zwischenablage zu kopieren, die dann mit **[Kellnerds Voice Actor Credits-Skript](https://github.com/kellnerd/musicbrainz-scripts?tab=readme-ov-file#voice-actor-credits)** eingefügt werden können.',
	],
	match: '*://shop.holysoft.de/produkte/*',
};

export default metadata;
