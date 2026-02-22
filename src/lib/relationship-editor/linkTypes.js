
/**
 * MBS relationship link type IDs (incomplete).
 * @type {Record<CoreEntityTypeT, Record<CoreEntityTypeT, Record<string, number>>>}
 */
export const LINK_TYPES = {
	release: {
		artist: {
			'©': 709,
			'℗': 710,
			Mix: 26,
			Editor: 38,
			Producer: 30,
			Writer: 54,
			Vocal: 60,
			Illustration: 927,
			Audio_director: 1187,
			Sound_effects: 1235,
		},
		label: {
			'©': 708,
			'℗': 711,
			'licensed from': 712,
			'licensed to': 833,
			'distributed by': 361,
			'manufactured by': 360,
			'marketed by': 848,
		},
	},
	recording: {
		artist: {
			'℗': 869,
			Mix: 143,
			Editor: 144,
			Producer: 141,
			Vocal: 149,
			Illustration: 1244,
			Audio_director: 1186,
			Sound_effects: 1236,
		},
		label: {
			'℗': 867,
		},
	},
	work: {
		artist: {
			Writer: 167,
		},
	},
};

export const RELATIONSHIP_ATTRIBUTES = {
	additional: '0a5341f8-3b1d-4f99-a0c6-26b7f4e42c7f',
	assistant: '8c4196b1-7053-4b16-921a-f22b2898ed44',
	associate: '8d23d2dd-13df-43ea-85a0-d7eb38dc32ec',
	co: 'ac6f6b4c-a4ec-4483-a04e-9f425a914573',
	instrument: '0abd7f04-5e28-425b-956f-94789d9bcbe2',
	vocal: 'd92884b7-ee0c-46d5-96f3-918196ba8c5b',
	executive: 'e0039285-6667-4f94-80d6-aa6520c6d359',
	task: '39867b3b-0f1e-40d5-b602-4f3936b7f486',
	Spoken_vocals: 'd3a36e62-a7c4-4eb9-839f-adfebe87ac12',
};

/**
 * Returns the internal ID of the requested relationship link type.
 * @param {CoreEntityTypeT} sourceType Type of the source entity.
 * @param {CoreEntityTypeT} targetType Type of the target entity.
 * @param {string} relType
 */
export function getLinkTypeId(sourceType, targetType, relType) {
	const linkTypeId = LINK_TYPES[targetType]?.[sourceType]?.[relType];

	if (linkTypeId) {
		return linkTypeId;
	} else {
		return false;
	}
}

/**
 * @description Gibt die GID zum gegebenen Attribute zurück
 * @author Eichi76
 * @date 2025-04-05
 * @param {string} attributeName
 * @returns {string}
 */
export function getAttributeGID(attributeName) {
	const attributeGID = RELATIONSHIP_ATTRIBUTES[attributeName];

	if (attributeGID) {
		return attributeGID;
	} else {
		throw new Error(`Unsupported Attribute relationship type '${attributeName}'`);
	}
}
