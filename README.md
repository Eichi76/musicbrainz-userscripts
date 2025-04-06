# _Surprise!_

- Yes, I can program a little!
- Yes, the preferred language of programmers is English!

Do I speak English well and fluently? **NO!**

For this reason and because this project is mainly about a German-speaking phenomenon, I will write all texts in German. I don't feel like using the Deepl Translator to translate texts every time.
For the scripts I will try to include multilingual functionality, but the code comments will probably be in German.

So now I'm switching to German!

# musicbrainz-userscripts

**[Userscripts](https://en.wikipedia.org/wiki/Userscript) für [MusicBrainz.org](https://musicbrainz.org)**

Dieses Projekt beschäftigt sich mit **Userscripts**, die helfen sollen, Veröffentlichungen und andere Einträge zum **MusicBrainz.org** Projekt hinzuzufügen. Der Schwerpunkt der Skripte liegt auf Hörspielpublikationen.

Sie benötigen eine **Userskripten-Manager-Browsererweiterung** wie z.B. **[Tampermonkey](https://www.tampermonkey.net/)**, die die Userskripte für Dich verwaltet.
Um ein Skript zu installieren, klicke einfach auf die Schaltfläche _Installieren_ für das gewünschte Skript auf dieser Seite.

## Userscripts

### Hoerspielforscher Musicbrainz Import

Importiert Hörspielproduktionen von Hoerspielforschern
- Erstellt ein Importer Element um Hörspiele von **[Hörspielforscher](https://hoerspielforscher.de/)** in Musicbrainz zu hinzuzufügen
- Erlaubt dem Benutzer, permanente Namenszuweisungen zu bestehenden MBIDs des Künstlers/Labels/Veröffentlichungsgruppe/Serie einzugeben.
- Erkennt Serie/Folgennummer/Folgenname und erzeugt daraus einen eindeutigen Albumnamen, der geändert werden kann.
- Identifiziert die Anzahl der Medien der Veröffentlichung, sofern diese Information auf der Seite verfügbar ist.
- (in Planung) Für jedes Medium kann die Anzahl der Titel festgelegt werden, die dann mit beispielhaften Titelnamen an Musicbrainz übergeben werden.
- Erstellt einen Button, um die Sprecherrollen in die Zwischenablage zu kopieren, die dann mit **[Kellnerds Voice Actor Credits-Skript](https://github.com/kellnerd/musicbrainz-scripts?tab=readme-ov-file#voice-actor-credits)** eingefügt werden können.
- (optional|in Entwickluckung) Kopieren eines JSON Strings der gesamten Crew in die Zwischenablage welches mit **[Kellnerds Voice Actor Credits-Skript](https://github.com/kellnerd/musicbrainz-scripts?tab=readme-ov-file#voice-actor-credits)** eingefügt werden kann

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](dist/hoerspielforscher.user.js?raw=1)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](dist/hoerspielforscher.user.js)

### Holysoft Musicbrainz Import

Importiert Hörspielproduktionen aus dem Holysoft Shop und erstellt einen String, um die entsprechende Crew bei Musicbrainz hinzuzufügen.
- Erstellt ein Formular auf der linken Seite unter dem Cover bei Holysoft Produktionen im **[Holysoft-Shop](https://shop.holysoft.de/)**
- Erlaubt dem Benutzer, permanente Namenszuweisungen zu bestehenden MBIDs des Künstlers einzugeben.
- Erkennt Serie/Folgennummer/Folgenname und erzeugt daraus einen eindeutigen Albumnamen, der geändert werden kann.
- Identifiziert die Anzahl der Medien der Veröffentlichung, sofern diese Information auf der Seite verfügbar ist.
- Für jedes Medium kann die Anzahl der Titel festgelegt werden, die dann mit beispielhaften Titelnamen an Musicbrainz übergeben werden.
- Erstellt einen Button, um die Sprecherrollen in die Zwischenablage zu kopieren, die dann mit **[Kellnerds Voice Actor Credits-Skript](https://github.com/kellnerd/musicbrainz-scripts?tab=readme-ov-file#voice-actor-credits)** eingefügt werden können.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](dist/holysoft.user.js?raw=1)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](dist/holysoft.user.js)
