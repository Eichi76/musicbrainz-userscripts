import { closingDialog, createBatchDialog, createDialog, creditTargetAs } from './createDialog.js';
import { batchCreateRelationships, createAttributeTree, createRelationship } from './createRelationship.js';
import { entityCache } from '@kellnerd/musicbrainz-scripts/src/entityCache.js';
import { nameToMBIDCache } from '@kellnerd/musicbrainz-scripts/src/nameToMBIDCache.js';
import { fetchVoiceActors as fetchVoiceActorsFromDiscogs } from '@kellnerd/musicbrainz-scripts/src/discogs/api.js';
import { buildEntityURL as buildDiscogsURL } from '@kellnerd/musicbrainz-scripts/src/discogs/entity.js';
import { discogsToMBIDCache } from '@kellnerd/musicbrainz-scripts/src/discogs/entityMapping.js';
import { getLinkTypeId, getAttributeGID } from './linkTypes.js';
/**
 * Adds a voice actor relationship for the given artist and their role.
 * Automatically maps artist names to MBIDs where possible, asks the user to match the remaining ones.
 * If recordings are selected, the voice actor relationships will be added to these, otherwise they target the release.
 * @param {string} artistName Artist name (as credited).
 * @param {string} roleName Credited role of the artist.
 * @param {boolean} [bypassCache] Bypass the name to MBID cache to overwrite wrong entries, disabled by default.
 * @returns {Promise<CreditParserLineStatus>}
 */
export async function addVoiceActor(artistName, roleName, bypassCache = false, crewImport = {}) {
	const artistMBID = !bypassCache && (await nameToMBIDCache.get('artist', artistName));

	/** @type {import('weight-balanced-tree').ImmutableTree<RecordingT> | null} */
	const recordings = MB.relationshipEditor.state.selectedRecordings;

	if (artistMBID) {
		// mapping already exists, automatically add the relationship
		const artist = await entityCache.get(artistMBID);
		createVoiceActorRelationship({ artist, roleName, artistCredit: artistName, recordings, crewImport });

		return 'done';
	} else {
		// pre-fill dialog and collect mappings for freshly matched artists
		const artistMatch = await letUserSelectVoiceActor({
			artistName,
			roleName,
			artistCredit: artistName,
			recordings,
			crewImport,
		});

		if (artistMatch?.gid) {
			nameToMBIDCache.set(['artist', artistName], artistMatch.gid);
			return 'done';
		} else {
			return 'skipped';
		}
	}
}

/**
 * Imports all existing voice actor credits from the given Discogs release.
 * Automatically maps Discogs entities to MBIDs where possible, asks the user to match the remaining ones.
 * @param {string} releaseURL URL of the Discogs source release.
 * @returns - Number of credits (total & automatically mapped).
 * - List of unmapped entities (manually matched or skipped) for which MB does not store the Discogs URLs.
 */
export async function importVoiceActorsFromDiscogs(releaseURL) {
	/**
	 * Unmapped entities for which MB does not store the Discogs URLs.
	 * @type {EntityMapping[]}
	 */
	const unmappedArtists = [];
	let mappedCredits = 0;

	const actors = await fetchVoiceActorsFromDiscogs(releaseURL);
	for (const actor of actors) {
		console.debug(actor);
		let roleName = actor.roleCredit;

		// always give Discogs narrators a role name,
		// otherwise both "Narrator" and "Voice Actors" roles are mapped to MB's "spoken vocals" rels without distinction
		if (!roleName && actor.role === 'Narrator') {
			roleName = 'Narrator'; // TODO: localize according to release language?
		}

		const artistCredit = actor.anv; // we are already using the name as a fallback
		const artistMBID = await discogsToMBIDCache.get('artist', actor.id);

		if (artistMBID) {
			// mapping already exists, automatically add the relationship
			const mbArtist = await entityCache.get(artistMBID);
			createVoiceActorRelationship({ artist: mbArtist, roleName, artistCredit });
			mappedCredits++;
			// duplicates of already existing rels will be merged automatically
		} else {
			// pre-fill dialog and collect mappings for freshly matched artists
			const artistMatch = await letUserSelectVoiceActor({ artistName: actor.name, roleName, artistCredit });

			if (artistMatch?.gid) {
				discogsToMBIDCache.set(['artist', actor.id], artistMatch.gid);
				unmappedArtists.push({
					MBID: artistMatch.gid,
					name: artistMatch.name,
					comment: artistMatch.comment,
					externalURL: buildDiscogsURL('artist', actor.id),
					externalName: actor.name,
				});
			}
		}
	}

	// persist cache entries after each import, TODO: only do this on page unload
	discogsToMBIDCache.store();

	return {
		totalCredits: actors.length,
		mappedCredits,
		unmappedArtists,
	};
}

async function letUserSelectVoiceActor({ artistName, roleName, artistCredit, recordings, crewImport = {} }) {
	let dialogState = await createVoiceActorDialog({
		artist: artistName,
		roleName,
		artistCredit,
		recordings,
		crewImport,
	});

	// let the user select the matching entity
	// Wenn ein Fenster erstellt wurde wird undefined zurckgegeben ansonsten 'skipped'
	if (dialogState === undefined) {
		const finalState = await closingDialog();
		// only use the selected target artist of accepted dialogs
		if (finalState.closeEventType === 'accept') {
			return finalState.targetEntity.target;
		}
	}
	return dialogState;
}

/**
 * Creates an "Add relationship" dialogue where the type "vocals" and the attribute "spoken vocals" are pre-selected.
 * Optionally the performing artist (voice actor) and the name of the role can be pre-filled.
 * @param {Object} [options]
 * @param {string | ArtistT} [options.artist] Performing artist object or name (optional).
 * @param {string} [options.roleName] Credited name of the voice actor's role (optional).
 * @param {string} [options.artistCredit] Credited name of the performing artist (optional).
 * @param {import('weight-balanced-tree').ImmutableTree<RecordingT>} [options.recordings]
 * Recordings to create the dialog for (fallback to release).
 */
export async function createVoiceActorDialog({ artist, roleName, artistCredit, recordings, crewImport } = {}) {
	let attr_gid;
	let attr_obj = {};
	// Wenn ein Object besteht...
	if (crewImport.name) {
		// ... und es ein Attribute gibt...
		if (crewImport.attributesTypes[0]?.type) {
			// ...speichere die GID in einer Variabel
			attr_gid = getAttributeGID(crewImport.attributesTypes[0].type);
		}
	} else {
		// sollte kein Object bestehen ist die GID = Spoken Vocals
		attr_gid = 'd3a36e62-a7c4-4eb9-839f-adfebe87ac12';
	}
	// Wenn es eine Attribute GID gibt setze diese in das Object fr createAttributeTree
	if (attr_gid) {
		attr_obj['type'] = { gid: attr_gid };
	}
	// Wenn es einen Rollenname gibt setze die Eigenschaft in das Object fr createAttributeTree
	if (roleName != '') {
		attr_obj['credited_as'] = roleName;
	}
	const vocalAttributes = attr_obj?.type ? [attr_obj] : undefined;
	// Objet zum erstellen von Beziehung
	let relship_obj = { target: artist, targetType: 'artist' };
	// Webb es Attribute gibt
	if (vocalAttributes) {
		// ... fge diese dem Object fr die Beziehungen hinzu
		relship_obj['attributes'] = vocalAttributes;
	}
	if (recordings && recordings.size > 0) {
		// setze die Standard linktypID fr Recoring -> Vocals
		let linkTypeID = 149;
		// Wenn es ein Crew Object gibt
		if (crewImport.linktype) {
			// ... und der Linkty bekannt ist...
			if (getLinkTypeId(crewImport.targetType, 'recording', crewImport.linktype)) {
				// ...speichere die ID in eine Variabel
				linkTypeID = getLinkTypeId(crewImport.targetType, 'recording', crewImport.linktype);
			} else {
				console.log('Fehler', `Unsupported Recording relationship type '${crewImport.linktype}'`);
				return 'skipped';
			}
		}
		await createBatchDialog(recordings, {
			linkTypeId: linkTypeID,
			...relship_obj,
		});
	} else {
		// Sollte die Beziehung nicht zu Recordings sein wird der Linktyp fr Release benutzt
		// setze die Standard linktypID fr Release -> Vocals
		let linkTypeID = 60;
		// Wenn es ein Crew Object gibt
		if (crewImport.linktype) {
			// ... und der Linkty bekannt ist...
			if (getLinkTypeId(crewImport.targetType, 'release', crewImport.linktype)) {
				// ...speichere die ID in eine Variabel
				linkTypeID = getLinkTypeId(crewImport.targetType, 'release', crewImport.linktype);
			} else {
				console.log('Fehler', `Unsupported Release relationship type '${crewImport.linktype}'`);
				return 'skipped';
			}
		}
		console.log('createDialog', { linkTypeId: linkTypeID, ...relship_obj });
		await createDialog({
			linkTypeId: linkTypeID,
			...relship_obj,
		});
	}

	if (artistCredit) {
		creditTargetAs(artistCredit);
	}
}

/**
 * @param {Object} [options]
 * @param {ArtistT} options.artist The performing artist.
 * @param {string} [options.roleName] Credited name of the voice actor's role (optional).
 * @param {string} [options.artistCredit] Credited name of the performing artist (optional).
 * @param {import('weight-balanced-tree').ImmutableTree<RecordingT>} [options.recordings]
 * Recordings to create the relationships for (fallback to release).
 */
export function createVoiceActorRelationship({ artist, roleName, artistCredit, recordings, crewImport = {} }) {
	let attr_gid;
	let attr_obj = {};
	// Wenn eub Object besteht...
	if (crewImport.name) {
		// ... und es ein Attribute gibt...
		if (crewImport.attributesTypes[0]?.type) {
			// ...speichere die GID in einer Variabel
			attr_gid = getAttributeGID(crewImport.attributesTypes[0].type);
		}
	} else {
		// sollte kein Object bestehen ist die GID = Spoken Vocals
		attr_gid = 'd3a36e62-a7c4-4eb9-839f-adfebe87ac12';
	}
	// Wenn es eine Attribute GID gibt setze diese in das Object fr createAttributeTree
	if (attr_gid) {
		attr_obj['type'] = { gid: attr_gid };
	}
	// Wenn es einen Rollenname gibt setze die Eigenschaft in das Object fr createAttributeTree
	if (roleName != '') {
		attr_obj['credited_as'] = roleName;
	}
	const vocalAttributes = attr_obj?.type ? createAttributeTree(attr_obj) : undefined;
	// Objet zum erstellen von Beziehung
	let relship_obj = { entity0_credit: artistCredit };
	// Webb es Attribute gibt
	if (vocalAttributes?.value) {
		// ... fge diese dem Object fr die Beziehungen hinzu
		relship_obj['attributes'] = vocalAttributes;
	}
	if (recordings && recordings.size > 0) {
		// setze die Standard linktypID fr Recoring -> Vocals
		let linkTypeID = 149;
		// Wenn es ein Crew Object gibt
		if (crewImport.linktype) {
			// ... und der Linkty bekannt ist...
			if (getLinkTypeId(crewImport.targetType, 'recording', crewImport.linktype)) {
				// ...speichere die ID in eine Variabel
				linkTypeID = getLinkTypeId(crewImport.targetType, 'recording', crewImport.linktype);
			} else {
				console.log('Fehler', `Unsupported Recording relationship type '${crewImport.linktype}'`);
				return 'skipped';
			}
		}
		// Erstelle die Beziehung zu den Recordings
		batchCreateRelationships(recordings, artist, {
			linkTypeID: linkTypeID,
			...relship_obj,
		});
	} else {
		// Sollte die Beziehung nicht zu Recordings sein wird der Linktyp fr Release benutzt
		// setze die Standard linktypID fr Release -> Vocals
		let linkTypeID = 60;
		// Wenn es ein Crew Object gibt
		if (crewImport.linktype) {
			// ... und der Linkty bekannt ist...
			if (getLinkTypeId(crewImport.targetType, 'release', crewImport.linktype)) {
				// ...speichere die ID in eine Variabel
				linkTypeID = getLinkTypeId(crewImport.targetType, 'release', crewImport.linktype);
			} else {
				console.log('Fehler', `Unsupported Release relationship type '${crewImport.linktype}'`);
				return 'skipped';
			}
		}
		// Erstelle die Beziehung zum Release
		createRelationship({
			target: artist,
			linkTypeID: linkTypeID,
			...relship_obj,
		});
	}
}
