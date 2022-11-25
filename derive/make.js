import {mkdirSync, writeFileSync, createWriteStream, cp} from 'node:fs';
import {compare_arrays, explode_cp, permutations, parse_cp_sequence, print_section, print_checked, print_table, group_by} from './utils.js';
import {UNICODE, NF, IDNA, PRINTER} from './unicode-version.js';
import CHARS_VALID from './rules/chars-valid.js';
import CHARS_DISALLOWED from './rules/chars-disallow.js';
import CHARS_MAPPED from './rules/chars-mapped.js';
import CHARS_ESCAPE from './rules/chars-escape.js';
import CHARS_FENCED from './rules/chars-fenced.js';
import GROUP_ORDER from './rules/group-order.js';
import {CONFUSE_GROUPS, CONFUSE_DEFAULT_ALLOW, CONFUSE_TYPE_VALID, CONFUSE_TYPE_ALLOW} from './rules/confuse.js';
import {EMOJI_DEMOTED, EMOJI_DISABLED, EMOJI_SEQ_WHITELIST, EMOJI_SEQ_BLACKLIST} from './rules/emoji.js';
import {CM_WHITELIST} from './rules/cm.js';
import {SCRIPT_GROUPS, RESTRICTED_SCRIPTS, SCRIPT_EXTENSIONS, DISALLOWED_SCRIPTS} from './rules/scripts.js';

const STOP = 0x2E; // label separator
const FE0F = 0xFE0F;

let out_dir = new URL('./output/', import.meta.url);

// quick hack to capture log
((stream) => {
	let out = createWriteStream(new URL('./log.txt', out_dir).pathname);
	let old = stream.write.bind(stream);
	stream.write = function(...a) {
		old(...a);
		out.write(...a);
	};
})(process.stdout);

function version_str(obj) {
	return `${obj.version} (${obj.date})`;
}

console.log(`Build Date: ${new Date().toJSON()}`);
console.log(`Unicode Version: ${version_str(UNICODE.unicode_version)}`);
console.log(`CLDR Version: ${version_str(UNICODE.cldr_version)}`);

// these are our primary output structures
let ignored = new Set(IDNA.ignored);
let valid = new Set(IDNA.valid);
let mapped = new Map(IDNA.mapped);
let valid_emoji = new Map();

function disallow_char(cp) {	
	let ys = mapped.get(cp);
	if (ys) {
		mapped.delete(cp);
		console.log(`Removed Mapped: ${PRINTER.desc_for_mapped(cp, ys)}`);
	} else if (ignored.delete(cp)) {
		console.log(`Removed Ignored: ${PRINTER.desc_for_cp(cp)}`);
	} else if (valid.delete(cp)) {
		console.log(`Removed Valid: ${PRINTER.desc_for_cp(cp)}`);
	}
}

function register_emoji(info) {
	try {
		let {cps} = info;
		if (!Array.isArray(cps) || !cps.length) throw new Error('expected cps');
		if (!info.name) throw new Error('expected name');
		if (!info.type) throw new Error('expected type');
		let key = String.fromCodePoint(...cps);
		let old = valid_emoji.get(key);
		if (old) {
			console.log(old);
			throw new Error(`duplicate`);
		}
		console.log(`Register Emoji [${info.type}]: ${PRINTER.desc_for_emoji(info)}`);
		valid_emoji.set(key, info);
	} catch (err) {
		console.log(info);
		throw err;
	}
}

let emoji_zwjs = UNICODE.read_emoji_zwjs();
print_section('RGI Emoji ZWJ Sequences');
emoji_zwjs.RGI_Emoji_ZWJ_Sequence.forEach(register_emoji);

let emoji_seqs = UNICODE.read_emoji_seqs();
print_section('RGI Emoji Keycap Sequences');
emoji_seqs.Emoji_Keycap_Sequence.forEach(register_emoji);
print_section('RGI Emoji Tag Sequences');
emoji_seqs.RGI_Emoji_Tag_Sequence.forEach(register_emoji);
print_section('RGI Emoji Modifier Sequences');
emoji_seqs.RGI_Emoji_Modifier_Sequence.forEach(register_emoji);
// derive flag sequences with valid regions
// warning: this contains EZ and QO
// UNICODE.derive_emoji_flag_sequences().forEach(register_emoji);
// use the following instead
print_section('RGI Emoji Flag Sequences');
emoji_seqs.RGI_Emoji_Flag_Sequence.forEach(register_emoji);

let emoji_disabled = [];
let emoji_chrs = UNICODE.read_emoji_data();
let emoji_map = new Map(emoji_chrs.Emoji.map(x => [x.cp, x]));

print_section(`Demote Emoji to Characters`);
for (let cp of EMOJI_DEMOTED) {
	let info = emoji_map.get(cp);
	if (!info) throw new Error(`Expected emoji: ${PRINTER.desc_for_cp(cp)}`);
	if (info.used) throw new Error(`Duplicate: ${PRINTER.desc_for_cp(cp)}`);
	info.used = true;
	emoji_disabled.push(info);
	console.log(`Demoted Emoji: ${PRINTER.desc_for_emoji(info)}`);
}

print_section(`Disable Emoji (and Characters)`);
for (let cp of EMOJI_DISABLED) {
	let info = emoji_map.get(cp);
	if (!info) throw new Error(`Expected emoji: ${PRINTER.desc_for_cp(cp)}`);
	if (info.used) throw new Error(`Duplicate: ${PRINTER.desc_for_cp(cp)}`);
	info.used = true;
	emoji_disabled.push(info);
	disallow_char(cp);
}

print_section('Remove Emoji from Characters');
for (let info of emoji_map.values()) {
	if (info.used) continue;
	disallow_char(info.cp);
}

print_section('Register Basic Emoji with Forced Emoji-Presentation');
for (let seq of emoji_seqs.Basic_Emoji) {
	let {cps} = seq;
	if (cps.length == 2 && cps[1] == FE0F) { // X + FE0F
		let info = emoji_map.get(cps[0]);
		if (!info) throw new Error(`Expected emoji: ${PRINTER.desc_for_emoji(seq)}`);	
		if (info.used) continue;
		info.used = true;
		register_emoji(seq);
	}
}

print_section('Register Default Emoji-Presentation Emoji');
for (let seq of emoji_chrs.Emoji_Presentation) {
	let info = emoji_map.get(seq.cp);
	if (!info) throw new Error(`Expected emoji: ${PRINTER.desc_for_emoji(seq)}`);	
	if (info.used) continue;
	info.used = true;
	register_emoji({cps: [seq.cp, FE0F], ...seq});
}

print_section('Register Leftover Emoji');
for (let info of emoji_map.values()) {
	if (!info.used) {
		register_emoji({cps: [info.cp], ...info});
	}
}

print_section(`Whitelist Emoji`);
for (let info of EMOJI_SEQ_WHITELIST) {
	register_emoji({cps: parse_cp_sequence(info.hex), type: 'Whitelisted', name: info.name});
}

print_section(`Blacklist Emoji`);
for (let def of EMOJI_SEQ_BLACKLIST) {
	let cps = Number.isInteger(def) ? [def] : parse_cp_sequence(def);
	let key = String.fromCodePoint(...cps);
	let info = valid_emoji.get(key);
	if (!info) throw new Error(`Expected emoji sequence: ${PRINTER.desc_for_cps(cps)}`);
	console.log(`Unregistered Emoji: ${PRINTER.desc_for_emoji(info)}`);
	emoji_disabled.push(info);
	valid_emoji.delete(key);
}

print_section(`Add Mapped Characters`);
for (let [x, ys] of CHARS_MAPPED) {
	let old = mapped.get(x);
	if (old && !compare_arrays(old, ys)) throw new Error(`Duplicate mapped: ${PRINTER.desc_for_mapped(x, ys)}`);
	disallow_char(x);
	mapped.set(x, ys);
	console.log(`Add Mapped: ${PRINTER.desc_for_mapped(x, ys)}`);
}

print_section(`Remove Disallowed Characters`);
for (let cp of CHARS_DISALLOWED) {
	if (!mapped.has(cp) && !ignored.has(cp) && !valid.has(cp)) {
		console.log(`*** Already disallowed: ${PRINTER.desc_for_cp(cp)}`); // not fatal		
	}
	disallow_char(cp);
}

print_section(`Add Valid Characters`);
for (let cp of CHARS_VALID) {
	if (valid.has(cp)) throw new Error(`Already valid: ${PRINTER.desc_for_cp(cp)}`);
	disallow_char(cp);
	valid.add(cp);
	console.log(`Added Valid: ${PRINTER.desc_for_cp(cp)}`);
}


print_section(`Apply ScriptExt`);
for (let [cp, abbrs] of SCRIPT_EXTENSIONS) {
	try {
		if (!valid.has(cp)) throw new Error(`Not Valid`);
		if (!abbrs.length) throw new Error(`Empty`);
		//if (abbrs.includes('Zyyy') && abbrs.length > 1) throw new Error(`Common + 1`)
		let scripts = [...new Set(abbrs.sort().map(x => UNICODE.require_script(x)))]; // sorted
		let char = UNICODE.require_char(cp);
		console.log(`${PRINTER.desc_for_cp(cp)} [${char.get_extended().map(x => x.abbr)} => ${scripts.map(x => x.abbr)}]`);
		char.extended = scripts; // replace
	} catch (err) {
		throw new Error(`ScriptExt "${err.message}": ${PRINTER.desc_for_cp(cp)}`);
	}
}

/*
// this should happen automatically
// remove characters that are specific to this script 
// and not extended beyond the disallowed set
print_section('Remove Disallowed Scripts');
for (let script of disallowed_scripts) {
	console.log(`Script: ${script.description}`);
	for (let char of script.map.values()) {
		if (!char.extended || char.extended.every(x => disallowed_scripts.has(x))) {
			disallow_char(char.cp);
		}
	}
}
*/


// these are some more primary output structures
print_section('Create Groups');

class ScriptGroup {
	constructor(name, test, rest, extra, cm) {
		this.name = name;
		this.test_script_set = test;
		this.rest_script_set = rest;
		this.extra_set = extra;
		this.cm = cm;
		this.valid_set = new Set();
		this.cm_map = new Map();
		this.confuse_set = new Set();
	}
	compute_parts() {
		return new Set([
			// nfc chars
			...this.valid_set,
			// nfd parts
			[...this.valid_set].map(cp => NF.nfd([cp])),
			// necessary cm
			...this.cm_map.values(),
		].flat(Infinity));
	}
}

let untested_set = new Set(UNICODE.script_map.values());	
untested_set.delete(UNICODE.require_script('Zinh')); // should not be testable
untested_set.delete(UNICODE.require_script('Zzzz')); // should not be used
let script_groups = [];
for (let config of SCRIPT_GROUPS) {
	let {name, test, rest = [], extra = [], cm = 1} = config;
	try {
		if (!name) throw new Error(`Expected name`);
		if (!Array.isArray(test) || test.length == 0) throw new Error(`Expected test`);
		let test_set = new Set();
		for (let abbr of test) {
			let script = UNICODE.require_script(abbr);
			// every testable script can only be used once
			if (!untested_set.delete(script)) {
				throw new Error(`Duplicate: ${script.description}`);
			}
			test_set.add(script);
		}
		let rest_set = new Set();
		for (let abbr of rest) {
			let script = UNICODE.require_script(abbr);
			if (test_set.has(script)) {
				throw new Error(`Test + Rest: ${script.description}`);
			}
			if (rest_set.has(script)) {
				throw new Error(`Duplicate: ${script.description}`);
			}
			rest_set.add(script);
		}
		// there are no restrictions on extra
		// we can enforce this later
		let extra_set = new Set(extra.flat(Infinity).flatMap(x => typeof x === 'string' ? explode_cp(x) : x));
		let group = new ScriptGroup(name, test_set, rest_set, extra_set, cm);
		script_groups.push(group);
	} catch (err) {
		console.log(config);
		throw err;
	}
}
for (let abbr of DISALLOWED_SCRIPTS) {
	let script = UNICODE.require_script(abbr);
	if (!untested_set.delete(script)) {
		throw new Error(`Missing disallowed script: ${script.description}`);
	}
	console.log(`Disallowed Script: ${script.description}`);
}
for (let abbr of RESTRICTED_SCRIPTS) {
	let script = UNICODE.require_script(abbr);
	if (!untested_set.delete(script)) {
		throw new Error(`Missing restricted script: ${script.description}`);
	}
	let group = new ScriptGroup(/*script.name*/script.abbr, new Set([script]), new Set(), new Set(), 1);
	group.restricted = true;
	script_groups.push(group);
}
if (untested_set.size) {
	console.log([...untested_set].map(x => x.description));
	throw new Error('leftover scripts');
}
for (let cp of valid) {
	let char = UNICODE.require_char(cp);
	let scripts = char.get_extended();
	for (let g of script_groups) {
		if (scripts.some(s => g.test_script_set.has(s) || g.rest_script_set.has(s)) || g.extra_set.has(cp)) {
			g.valid_set.add(cp);
		}
	}
}
const MAX_GROUP_NAME_LEN = Math.max(...script_groups.map(g => g.name.length));
for (let g of script_groups) {
	let desc = `${g.valid_set.size.toString().padStart(7)} ${g.name.padEnd(MAX_GROUP_NAME_LEN)}`;
	desc += ` [${[...g.test_script_set].map(s => s.abbr)}]`;
	if (g.rest_script_set.size) {
		desc += ` + [${[...g.rest_script_set].map(s => s.abbr)}]`;
	}
	if (g.extra_set.size) {
		desc += ` + "${[...g.extra_set].map(cp => UNICODE.safe_str(cp, true)).join('')}"`;
	}
	if (g.restricted) {
		desc += ' (Restricted)';
	}
	console.log(desc);
}

print_section(`Compute CM Whitelist`);
let cm_whitelist = new Set();
for (let form of CM_WHITELIST) {
	let cps = NF.nfc(explode_cp(form));
	try {
		let key = String.fromCodePoint(...cps); 
		if (cm_whitelist.has(key)) {
			throw new Error('Duplicate');
		}
		cm_whitelist.add(key);
		let [nfc_cp0, ...cms] = cps;
		let base_char = UNICODE.require_char(nfc_cp0);
		if (!valid.has(nfc_cp0)) throw new Error(`Base not Valid: ${PRINTER.desc_for_cp(nfc_cp0)}`);
		if (base_char.is_cm) throw new Error(`Base is CM: ${PRINTER.desc_for_cp(nfc_cp0)}`);
		let groups = script_groups.filter(g => g.valid_set.has(nfc_cp0));
		if (!groups.length) {
			throw new Error(`No group`);
		}
		for (let cp of cms) {
			let char = UNICODE.require_char(cp);
			if (!char.is_cm) {
				throw new Error(`Not CM: ${PRINTER.desc_for_cp(cp)}`);
			}
			if (!valid.has(cp)) {
				throw new Error(`CM not Valid: ${PRINTER.desc_for_cp(cp)}`);
			}			
			for (let g of groups) {
				if (!g.valid_set.has(cp)) {
					throw new Error(`Group "${g.name} missing CM: ${PRINTER.desc_for_cp(cp)}`);
				}
			}
		}
		for (let g of groups) {
			let bucket = g.cm_map.get(nfc_cp0);
			if (!bucket) {
				bucket = [];
				g.cm_map.set(nfc_cp0, bucket);
			}
			bucket.push(cms);
		}
		console.log(`${PRINTER.desc_for_cps(cps)} <${cms.length}> "${ NF.nfd(cps).map(cp => UNICODE.safe_str(cp, true)).join('+')}" [${groups.map(g => g.name)}]`);
	} catch (err) {
		throw new Error(`Whitelist CM "${form}": ${err.message}`);
	}
}

for (let g of script_groups) {
	let purged = [];
	switch (g.cm) {
		case -1: { 
			// allow only whitelisted cm
			// remove unreachable
			let cm = new Set([...g.cm_map.values()].flat(Infinity)); 
			for (let cp of g.valid_set) {
				if (g.cm_map.has(cp)) continue; // whitelisted
				if (UNICODE.cm.has(cp) && cm.has(cp)) continue; // necessary
				if (NF.nfd([cp]).every(cp => !UNICODE.cm.has(cp) || cm.has(cp))) continue;	
				purged.push(cp);
			}
			break;
		}
		case 0: {
			// remove all cm
			for (let cp of g.valid_set) {
				if (UNICODE.cm.has(cp)) {
					purged.push(cp);
				}
			}
			break;
		}
		default: {
			// remove any char decomposes into too many cp
			for (let cp of g.valid_set) {
				let cps = NF.nfd([cp]);
				let cms = cps.filter(cp => UNICODE.cm.has(cp));
				if (cms.length > g.cm) {
					purged.push(cp);
				}
			}
		}
	}
	if (!purged.length) continue;
	print_section(`Purge CM: ${g.name} (${purged.length})`);
	for (let cp of purged) {		
		g.valid_set.delete(cp);
		console.log(PRINTER.desc_for_cp(cp));
	}
}

class Whole {
	constructor(target, defs, valid) {
		this.target = target;
		this.defs = defs; 
		this.valid = valid; // cp
		this.map = new Map(); // cp -> set<g>
	}
	add(cp, g) {
		let set = this.map.get(cp);
		if (!set) {
			set = new Set();
			this.map.set(cp, set);
		}
		set.add(g);
	}
	confused_for_group(g) {
		let ret = [];
		for (let [cp, set] of this.map) {
			if (set.has(g)) {
				ret.push(cp);
			}
		}
		return ret;
	}
}

print_section('Compute Confusables');
let wholes_list = [];
let confused_union = new Set();
script_groups.forEach(g => g.parts = g.compute_parts()); // cache
for (let [target, ...defs0] of CONFUSE_GROUPS) {
	let defs = [];
	for (let def of defs0) {
		if (Number.isInteger(def)) { // turn into structure
			def = {cp: def};
		}
		let {cp, type} = def;
		// assert that every confusable is unique
		if (confused_union.has(cp)) {
			throw new Error(`Duplicate confusable "${target}": ${PRINTER.desc_for_cp(cp)}`);
		}
		confused_union.add(cp);
		// check the type
		switch (type) {
			case undefined:
			case CONFUSE_TYPE_VALID:
			case CONFUSE_TYPE_ALLOW: break;
			default: throw new Error(`Unknown confusable type "${type}": ${PRINTER.desc_for_cp(cp)}`);
		}
		// find the groups that COULD contain this character
		let groups = script_groups.filter(g => g.parts.has(cp));
		// filter groups that allow cms
		// TODO: not really sure how to handle confusable-cms
		if (UNICODE.cm.has(cp)) {
			groups = groups.filter(g => g.cm > 0);
		}
		if (!groups.length) continue;
		def.groups = new Set(groups);
		def.restricted = groups.every(g => g.restricted); 
		defs.push(def);
	}
	if (defs.length < 2) continue;
	let union = new Set(defs.flatMap(x => [...x.groups]));
	
	// if theres no decisions and only 1 character is in an unrestricted group, make it valid
	if (!defs.some(x => x.type)) {
		let free = defs.filter(x => !x.restricted);
		if (free.length === 1) {
			let def = free[0];
			def.auto = true;
			def.type = CONFUSE_TYPE_VALID;
		}
	}

	let whole = new Whole(target, defs, defs.filter(def => def.type === CONFUSE_TYPE_VALID).map(def => def.cp));
	wholes_list.push(whole);

	let unresolved = {};
	for (let g of union) {
		let confuse = defs.filter(x => x.groups.has(g));
		let decided = confuse.filter(x => x.type); 
		
		// if theres any decisions, use that
		if (decided.length) {
			for (let def of confuse) {
				switch (def.type) {
					case CONFUSE_TYPE_VALID: // char can be used freely
						break;
					case CONFUSE_TYPE_ALLOW: // char requires additional hints
						//g.register_whole(cp, union);
						//allow.push([g, def.cp]);
						whole.add(def.cp, g);
						break;
					default: // char is single-script confusable
						g.valid_set.delete(def.cp);
				}
			}
			continue;
		}

		// there's only 1 for this group, ALLOW it
		if (confuse.length == 1) {
			//g.register_whole(confuse[0].cp, union);
			//allow.push([g, confuse[0].cp]);
			whole.add(confuse[0].cp, g);
			//register_whole(target, g, confuse[0], union);
			continue;
		}

		// keep track of it
		let key = confuse.map(def => def.cp).sort().join(); // meh
		let bucket = unresolved[key];
		if (!bucket) unresolved[key] = bucket = [];
		bucket.push(g);

		// there are 2 more confusables without a decision
		// for the same group 
		for (let def of confuse) {
			if (CONFUSE_DEFAULT_ALLOW) {
				//g.register_whole(def.cp, union);
				//register_whole(target, g, def, union);
				//allow.push([g, def.cp]);
				whole.add(def.cp, g);
			} else {
				g.valid_set.delete(def.cp);
			}
		}
	}
	if (!whole.map.size && !whole.valid.length) {
		throw new Error(`Confusable without member: ${target}`);
	}
	for (let def of defs) {
		if (def.type === CONFUSE_TYPE_VALID) {
			if (def.auto) {
				console.log(`Auto-Override: ${PRINTER.desc_for_cp(def.cp)} [${[...def.groups].map(g => g.name)} vs ${[...union].filter(g => !def.groups.has(g)).map(g => g.name)}]`);
			} else {		
				console.log(`Override: ${PRINTER.desc_for_cp(def.cp)} [${[...def.groups].map(x => x.name)}]`);
			}
		}
	}
	for (let [joined, gs] of Object.entries(unresolved)) {
		let cps = joined.split(',').map(s => parseInt(s));
		console.log(`Unresolved: [${gs.map(g => g.name)}] ${cps.map(x => PRINTER.desc_for_cp(x)).join(' vs ')}`);
	}
}
script_groups.forEach(g => delete g.parts); // remove cache


// find characters that can never be part of a name or its construction
print_section('Disallow Leftover Characters');
let parts_union = new Set(script_groups.flatMap(g => [...g.compute_parts()]));
for (let cp of valid) {
	if (!parts_union.has(cp)) {	
		disallow_char(cp);
	}
}

// this should be last so we dont need to recover toggled mappings
print_section('Remove Invalid Mappings');
for (let [x, ys] of mapped) {
	if (!ys.every(cp => valid.has(cp))) {
		mapped.delete(x);
		console.log(`Removed Mapping: ${PRINTER.desc_for_mapped(x, ys)}`);
	}
}

print_section('Remove Empty Groups');
script_groups = script_groups.filter(g => {
	if (g.valid_set.size) return true;
	console.log(`Removed Group: ${g.name}`);
	// remove whole links
	wholes_list = wholes_list.filter(w => {
		if (w.union.delete(g)) {
			if (!w.union.size) return false; // empty
			for (let [cp, set] of w.map) {
				if (set.delete(g) && set.size == 0) {
					w.map.delete(cp);
				}
			}
		}
		return true;
	});
});

// check that everything makes sense
print_section('Assert Invariants');

// check ignored exclusion
for (let cp of ignored) {
	if (valid.has(cp)) {
		throw new Error(`Ignored is Valid: ${PRINTER.desc_for_cp(cp)}`);
	} else if (mapped.has(cp)) {
		throw new Error(`Ignored is Mapped: ${PRINTER.desc_for_cp(cp)}`);
	}
}
print_checked(`Ignored`);

// check mapped exclusion
for (let [x, ys] of mapped) {
	if (valid.has(x)) {
		throw new Error(`Mapped is Valid: ${PRINTER.desc_for_mapped(x, ys)}`);
	}
}
print_checked('Mapped is Valid');

// check stop is valid
if (!valid.has(STOP)) {
	throw new Error(`Stop isn't Valid`);
}
for (let [x, ys] of mapped) {
	if (x == STOP || ys.includes(STOP)) {
		throw new Error(`Mapped contains Stop: ${PRINTER.desc_for_mapped(x, ys)}`);
	}
}
print_checked(`Stop isn't Mapped`);

for (let cp of valid) {
	if (!NF.is_nfc(cp)) {
		throw new Error(`Valid Non-NFC: ${PRINTER.desc_for_cp(cp)}`)
	}
}
print_checked(`Valid are NFC`);

// this prevents us from disabling a non-trivial intermediate part
for (let cp0 of valid) {
	let cps0 = NF.nfd([cp0]);
	let [base_cp, ...extra] = cps0;
	if (!extra.length) continue;
	for (let perm of permutations(extra)) {
		for (let n = 1; n <= perm.length; n++) {
			// rearrange it and see if it comes back together
			// this is safer than reimplementing NF reodering 
			let cps_part = NF.nfc([base_cp, ...perm.slice(0, n)]);
			let cps_rest = NF.nfc([...cps_part, ...perm.slice(n)]);
			if (cps_rest.length === 1 && cps_rest[0] === cp0) {
				for (let cp of cps_part) {
					if (!valid.has(cp)) {
						throw new Error(`Not Closed: ${PRINTER.desc_for_cp(cp0)} w/part ${PRINTER.desc_for_cp(cp)}`);
					}
				}
			}
		}
	}
}
print_checked(`Valid is Closed (via Brute-force)`);

let escaped = new Set(CHARS_ESCAPE);
for (let cp of escaped) {
	if (valid.has(cp)) {
		throw new Error(`Escaped character is valid: ${PRINTER.desc_for_cp(cp)}`);
	}
}
print_checked(`No Valid Escaped`);

for (let cp of UNICODE.get_noncharacter_cps()) {
	if (valid.has(cp)) {
		throw new Error(`Non-character is valid: ${PRINTER.desc_for_cp(cp)}`);
	}
}
print_checked('No Valid Non-Characters');

let fenced_map = new Map();
for (let [cp, name] of CHARS_FENCED) {
	if (!valid.has(cp)) {
		throw new Error(`Fenced character is not valid: ${PRINTER.desc_for_cp(cp)}`);
	}
	if (!name) name = UNICODE.get_name(cp, true);
	fenced_map.set(cp, name);
}
print_checked('Fenced are Valid');

let nonzero_cc = new Set([...UNICODE.char_map.values()].filter(x => x.cc).map(x => x.cp)); 
for (let info of valid_emoji.values()) {
	let {cps} = info;
	if (nonzero_cc.has(cps[0]) || nonzero_cc.has(cps[cps.length-1])) {
		throw new Error(`Emoji with non-zero CC Boundary: ${PRINTER.desc_for_emoji(info)}`);
	}
}
print_checked('Emoji Boundaries');

for (let info of valid_emoji.values()) {
	let {cps} = info;
	if (compare_arrays(cps, NF.nfc(cps))) {
		throw new Error(`Emoji doesn't survive NFC: ${PRINTER.desc_for_emoji(info)}`);
	}
}
print_checked('Emoji are NFC');

// check that ASCII can be fast-pathed
for (let cp = 0; cp < 0x80; cp++) {
	if (!valid.has(cp)) continue;
	try {
		let char = UNICODE.require_char(cp);
		if (!char.script) throw new Error(`Missing script`);
		if (NF.is_composite(cp)) throw new Error(`Decomposes`); // wont happen
		if (char.is_cm) throw new Error('CM'); // wont happen
		if (fenced_map.has(cp)) throw new Error('Fenced');	
		if (wholes_list.some(w => w.map.has(cp))) throw new Error('Whole');
		switch (char.script.abbr) {
			case 'Zyyy':
			case 'Latn': continue;
			default: throw new Error(`Unexpected script: ${char.script.description}`);
		}
	} catch (err) {
		throw new Error(`ASCII ${PRINTER.desc_for_cp(cp)}: ${err.message}`);
	}
}
print_checked(`Fastpath ASCII`);

for (let g of script_groups) {
	if (!/^[a-z]+$/i.test(g.name)) {
		throw new Error(`${g.name} isn't A-Z`);
	}
	let upper = g.name.slice(0, 1);
	let lower = g.name.slice(1);
	if (upper !== upper.toUpperCase() || lower !== lower.toLowerCase()) {
		throw new Error(`${g.name} has weird casing`);
	}
}
print_checked(`Groups Names are A-Z`);

print_section('Find Unique Characters');
let valid_union = new Set();
let multi_group = new Set();
for (let g of script_groups) {
	for (let cp of g.valid_set) {
		if (valid_union.has(cp)) {
			multi_group.add(cp);
		} else {
			valid_union.add(cp);
		}
	}
}
let valid_unique = new Set([...valid_union].filter(cp => !multi_group.has(cp)));
console.log('Valid:', valid_union.size);
console.log('Multi:', multi_group.size);
console.log('Unique:', valid_unique.size);
for (let g of script_groups) {
	g.unique_set = new Set([...valid_unique].filter(cp => g.valid_set.has(cp)));
	//g.confuse_map = new Map(wholes_list.flatMap(w => [...w.map.entries()].filter(([_, set]) => set.has(g)).map(([cp]) => [cp, w])));
	// determine of the group is orthogonal
	//g.orthogonal = g.valid_set.size === g.unique_set.size;
}

/*
for (let w of wholes_list) {
	if (!w.map.size) throw 33; // no characters
	if (w.valid.length == 0) {
		let union = new Set([...w.map.values()].flatMap(set => [...set]));
		if (union.size == 1) {
			if (w.map.size > 1) {
				let [g] = union;
				for (let cp of w.map.keys()) {
					g.confuse_set.add(cp);
				}
			}
			continue; // single script
		}
	}
}


// any character of these groups uniquely match these groups
// meaning any confusable is simply an exclusion set
print_section(`Remove Orthogonal Confusables`);
for (let g of script_groups) {
	if (g.orthogonal) {
		for (let w of wholes_list) {
			for (let [cp, set] of w.map) {
				if (set.delete(g)) {
					g.confuse_set.add(cp);
					if (!set.size) {
						w.map.delete(cp);
					}
				}
			}
		}		
	}
}
console.log(`Before: ${wholes_list.length}`);
wholes_list = wholes_list.filter(w => w.map.size);
console.log(` After: ${wholes_list.length}`);
*/

/*
let tally = [];
for (let w of wholes_list) {
	tally[w.map.size] = (tally[w.map.size]|0) + 1;
}
console.log(tally);

writeFileSync(new URL('./output/whole-dump.json', import.meta.url), JSON.stringify({
	wholes: wholes_list.map(w => {
		let {target, valid, map} = w;
		return {
			target,
			valid,
			confuse: [...map].map(([cp, set]) => [cp, [...set].map(g => g.name)]),
		};
	}),
	groups: script_groups.map(g => {
		let {name, valid_set, unique_set} = g;
		return {name, valid: sorted(valid_set), unique: sorted(unique_set)};
	})
}));

throw 1;


// find group overlaps
let supergroups = [];
for (let g of script_groups) {
	if (!g.orthogonal) {
		let sg = supergroups.find(sg => [...g.valid_set].some(cp => multi_group.has(cp) && sg.some(gg => gg.valid_set.has(cp))));
		if (!sg) {
			sg = [];
			supergroups.push(sg);
		}
		sg.push(g);
	}
}

for (let sg of supergroups) {
	let cps = [...multi_group];
	for (let g of sg) {
		cps = cps.filter(cp => g.valid_set.has(cp));
	}
	console.log(sg.map(g => g.name), cps);


}



console.log(supergroups.map(sg => sg.length));

throw 1;

for (let w of wholes) {
	for (let [cp, set] of w.map) {
		if (multi_group.has(cp)) {

		}
	}
}


// compute possible overlaps
let nonorthogonal = script_groups.filter(g => !g.orthogonal);

console.log(nonorthogonal.length);

for (let j = 1; j < nonorthogonal.length; j++) {	
	for (let i = 0; i < j; i++) {
		let set = new Set();
		let g_i = nonorthogonal[i];
		let g_j = nonorthogonal[j];
		for (let w of wholes_list) {
			let cps_i = w.confused_for_group(g_i);
			if (!cps_i.length) continue;
			let cps_j = w.confused_for_group(g_j);
			if (!cps_j.length) continue;
			cps_i.forEach(cp => set.add(cp));
			cps_j.forEach(cp => set.add(cp));
		}
		let diff = [...set].filter(cp => g_i.valid_set.has(cp) != g_j.valid_set.has(cp));
		if (diff.length) {
			console.log(g_i.name, g_j.name, diff.length, set.size);
			for (let cp of set) {
				console.log(PRINTER.desc_for_cp(cp));
			}

			throw 1;
		}
	}
}

throw 1;
*/

print_checked(`Assert Whole Membership`);
for (let w of wholes_list) {
	for (let [cp, set] of w.map) {
		for (let g of set) {
			if (!g.valid_set.has(cp)) {
				throw new Error('bug');
			}
		}
	}
}

let confused_whole = wholes_list.flatMap(w => w.map.keys());
let confused_valid = wholes_list.flatMap(w => w.valid); 

console.log(`Confusable: ${confused_whole.length}`);
console.log(`Not Confusable: ${confused_valid.length}`);
console.log(`Non-Confusable Non-Unique: ${confused_valid.reduce((a, cp) => a + valid_unique.has(cp)|0, 0)}`);




// note: sorting isn't important, just nice to have
function sorted(v) {
	return [...v].sort((a, b) => a - b);
}

print_section('Compress Wholes');

let wholes = [];
for (let w of wholes_list) {
	if (!w.map.size) continue;
	wholes.push({
		target: w.target,
		valid: sorted(w.valid),
		confused: sorted(w.map.keys())
	});
}

/*
const SEP = '|';
let wholes = {};
for (let w of wholes_list) {
	if (!w.map.size) continue; // no characters
	if (w.valid.length == 0) {
		let union = new Set([...w.map.values()].flatMap(set => [...set]));
		if (union.size == 1) {
			//if (w.map.size > 1) {
			//	let [g] = union;
			//	for (let cp of w.map.keys()) {
			//		g.confuse_set.add(cp);
			//	}
			//}
			continue; // single script
		}
	}
	let cover = new Set();
	for (let g of script_groups) {
		if (w.valid.some(cp => g.valid_set.has(cp))) {
			cover.add(g);
		}
	}
	for (let set of w.map.values()) {
		for (let g of set) {
			cover.add(g);
		}
	}
	let key = [...cover].map(g => g.name).sort().join(SEP);
	let cps = wholes[key];
	if (!cps) wholes[key] = cps = [];
	cps.push(...w.map.keys());
}
wholes = Object.entries(wholes).map(([key, cps]) => [key.split(SEP), sorted(cps)]);
console.log(`Wholes: ${wholes.length}`);
*/



/*
let universe_whole_set = new Set();
let found = 0;
for (let g of script_groups) {
	let whole_set = g.whole_set = new Set();
	for (let w of wholes_list) {
		for (let [cp, set] of w.map) {
			if (set.has(g)) {
				found++;
				(w.valid.length ? whole_set : universe_whole_set).add(cp);
			}
		}
	}
}
console.log(`Free: ${found}`);
console.log(`Free: ${script_groups.reduce((a, g) => a + g.whole_set.size, 0)}`);
console.log(`Universal Whole Set: ${universe_whole_set.size}`);
*/

print_section('Compress Groups');
for (let g of script_groups) {
	let {name, test_script_set, valid_set, cm, cm_map, restricted} = g;
	if (cm == -1) {
		cm = [];
		for (let [cp, seqs] of cm_map) {
			if (seqs.length == 1 && seqs[0].length == 0) continue; // just a valid char
			seqs.sort(compare_arrays);
			cm.push({cp, seqs});
		}
		cm.sort((a, b) => a.cp - b.cp);
	}
	let primary = [];
	let secondary = [];
	for (let cp of sorted(valid_set)) {
		if (UNICODE.require_char(cp).get_extended().some(s => test_script_set.has(s))) {
			primary.push(cp);
		} else {
			secondary.push(cp);
		}
	}
	g.spec = {name, restricted, primary, secondary, cm}; // , confused: sorted(confuse_set)};
}

print_section('Order Groups');
// assign every group an ordering
script_groups.forEach(g => g.order = (1 + GROUP_ORDER.indexOf(g.name)) || Infinity);
// sort them
script_groups.sort((a, b) => {
	let c = (a.restricted|0) - (b.restricted|0);
	if (c == 0) c = a.order - b.order;
	return c;
});
// assign every group an index
script_groups.forEach((g, i) => g.index = i);
print_checked(`All Unrestricted before Restricted`);
print_checked(`Ordered by Registration Likelihood`);

print_section('Group Summary');
print_table(['Order', 'Valid', 'Unique', 'Primary', 'Secondary', 'CM', 'Group'], script_groups.map((g, i) => [
	i+1,
	g.valid_set.size,
	g.unique_set.size,
	g.spec.primary.length,
	g.spec.secondary.length,
	g.cm == -1 ? `[${g.spec.cm.length}]` : `N=${g.cm}`,
	//g.spec.confused.length,
	g.name
]));

// union of non-zero combining class + nfc_qc
print_section('NFC Quick Check');
let ranks = UNICODE.combining_ranks();
let nfc_qc = UNICODE.read_nf_props().NFC_QC.map(x => x[0]);
let nfc_check0 = [...new Set([ranks, nfc_qc].flat(Infinity))];
let nfc_check = nfc_check0.filter(cp => parts_union.has(cp));
console.log(`Optimized: ${nfc_check0.length} => ${nfc_check.length}`);


print_section('Write Output');

const created = new Date();
mkdirSync(out_dir, {recursive: true});
function write_json(name, json) {
	let file = new URL(name, out_dir);
	let buf = Buffer.from(JSON.stringify(json));
	writeFileSync(file, buf);
	console.log(`Wrote: ${name} [${buf.length}]`);
}

write_json('spec.json', {
	created,
	unicode: version_str(UNICODE.unicode_version),
	cldr: version_str(UNICODE.cldr_version),
	emoji: [...valid_emoji.values()].map(x => x.cps).sort(compare_arrays),
	ignored: sorted(ignored),
	mapped: [...mapped].sort((a, b) => a[0] - b[0]),
	fenced: [...fenced_map].sort((a, b) => a[0] - b[0]),
	wholes,
	cm: sorted(UNICODE.cm),
	escape: sorted(escaped),
	groups: script_groups.map(g => g.spec),
	nfc_check: sorted(nfc_check)
});

// this file should be independent so we can create a standalone nf implementation
write_json('nf.json', {
	created,
	unicode: version_str(UNICODE.unicode_version),
	ranks, // already sorted 
	exclusions: sorted(UNICODE.read_composition_exclusions()),
	decomp: UNICODE.decompositions(), // already sorted 
	qc: sorted(nfc_qc)
});
write_json('nf-tests.json', UNICODE.read_nf_tests());

// conveniences files (not critical)
// for emoji.html
for (let info of emoji_disabled) { // make every disabled emoji a solo-sequence 
	if (!info.cps) info.cps = [info.cp];
	info.type = 'Disabled';
}
write_json('emoji-info.json', [...valid_emoji.values(), ...emoji_disabled].map(info => {
	let {cps, name, version, type} = info;
	return {form: String.fromCodePoint(...cps), name, version, type};
}));

// for chars.html
// TODO: collapse this more
// TODO: include more information
write_json('names.json', {
	chars: [...UNICODE.char_map.values()].filter(x => !x.range).map(x => [x.cp, x.get_name(true)]),
	ranges: [...new Set([...UNICODE.char_map.values()].map(x => x.range).filter(x => x))].map(x => [x.cp0, x.cp1, x.prefix]),
	scripts: [...UNICODE.script_map.values()].map(({name, abbr, map}) => {
		return {name, abbr, cps: sorted(map.keys())};
	})
});

// for confuse.html

write_json('confused.json', {
	wholes: wholes_list.map(w => {
		let {target, valid, map, defs} = w;
		return {target, valid: sorted(valid), confused: sorted(map.keys()), defs: defs.map(def => {
			let {cp, type, groups} = def;
			return {cp, type, groups: [...groups].map(g => g.index)};
		})};
	})
});