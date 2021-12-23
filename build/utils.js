export function random_bytes(n) {	
	let v = new Uint8Array(n);
	for (let i = 0; i < n; i++) {
		v[i] = (Math.random() * 256)|0; 
	}
	return v;
}

export function set_intersect(...sets) {
	let n = sets.length;
	if (n == 0) throw new TypeError('no sets');
	let inter = new Set(sets[0]);
	for (let i = 1; i < n; i++) {
		let set = sets[i];
		for (let x of inter) {
			if (!set.has(x)) {
				inter.delete(x);
			}
		}
	}
	return inter;
}

export function set_union(...sets) {
	let union = new Set();
	for (let set of sets) {
		for (let x of set) {
			union.add(x);
		}
	}
	return union;
}

export function compare_array(a, b) {
	let {length: n} = a;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
}

// map over an objects values
export function map_values(obj, fn) {
	return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}

// my suggested inline ascii-safe unicode escape
// this is ES6 \u{X} without the \u
export function quote_cp(cp) {
	return `{${cp.toString(16).padStart(2, '0').toUpperCase()}}`;
}

export function escape_unicode(s) {
	// printable w/o:
	// 0x22 " (double-quote)
	// 0x7F DEL
	return s.replace(/[^\x20-\x21\x23-\x7E]/gu, x => quote_cp(x.codePointAt(0)));
	//return s.replace(/[^\.\-a-z0-9]/igu, x => quote_cp(x.codePointAt(0)));
}

export function escape_name_for_html(s) {
	// printable w/o:
	// html: 0x26 &, 0x3C <, 0x3E >
	// quote: 0x00-0x20 control, 0x7F DEL, whitespace, joiners
	return s.replace(/[\x00-\x20\x7F\xA0\u200C\u200D\s]/gu, x => quote_cp(x.codePointAt(0)))
	        .replace(/[^\x21-\x25\x27-\x3B\x3D\x3F-\x7E]/gu, x => `&#${x.codePointAt(0)};`);
}

export function take_from(v, fn) {
	let take = [], rest = [];
	for (let x of v) (fn(x) ? take : rest).push(x);
	v.splice(0, v.length, ...rest);
	return take;
}

export function split_ascending(cps) {
	return split_between(cps, (a, b) => b - a > 1).map(v => [v[0], v.length]);
}

// from a list of [[x,ys]...]
// find spans of [[x,ys],[x+dx,ys+dy],[x+2dx,ys+2dy],...]
export function split_linear(mapped, dx, dy) {
	let linear = [];
	mapped = mapped.map(v => v.slice());
	for (let i = 0; i < mapped.length; i++) {
		let row0 = mapped[i];
		let [x0, ys0] = row0;
		if (x0 == -1) continue; // marked
		let group = [row0];
		next: for (let j = i + 1; j < mapped.length; j++) {
			let row =  mapped[j];
			let [x, ys] = row;
			if (x == -1) continue; // marked
			let x1 = x0 + group.length * dx;
			if (x < x1) continue;
			if (x > x1) break;
			for (let k = 0; k < ys0.length; k++) {
				if (ys0[k] + group.length * dy != ys[k]) continue next;
			}
			group.push(row);
		}
		if (group.length > 1) {
			group.forEach(v => v[0] = -1); // mark used
			linear.push([x0, group.length, ys0]);
		}
	}
	return {linear, nonlinear: mapped.filter(v => v[0] >= 0)}; // remove marked
}

export function explode_cp(s) {
	if (typeof s != 'string') throw new TypeError(`expected string`);	
	return [...s].map(c => c.codePointAt(0));
}

// hex to dec
export function parse_cp(s) {
	let cp = parseInt(s, 16);
	if (!Number.isSafeInteger(cp) || cp < 0) throw new TypeError(`expected code point: ${s}`);
	return cp;
}

// "AAAA"      => [0xAAAA]
// "AAAA BBBB" => [0xAAAA, 0xBBBB]
export function parse_cp_sequence(s) {
	return s.split(/\s+/).map(parse_cp);
}

// "AAAA"       => [0xAAAA]
// "AAAA..AAAC" => [0xAAAA, 0xAAAB, 0xAAAC]
export function parse_cp_range(s) {
	let pos = s.indexOf('..');
	if (pos >= 0) {
		let lo = parse_cp(s.slice(0, pos));
		let hi = parse_cp(s.slice(pos + 2));
		if (hi < lo) throw new Error(`expected non-empty range: ${s}`);
		return Array(hi - lo + 1).fill().map((_, i) => lo + i);
	} else {
		return [parse_cp(s)];
	}
}

// return all indicies of exact match in array
// [1, 2, 1, 1] of 1 => [0, 2, 3]
export function indices_of(v, x) {
	let ret = [];
	let last = 0;
	while (true) {
		let i = v.indexOf(x, last);
		if (i == -1) break;
		ret.push(i);
		last = i + 1;
	}
	return ret;
}

// group list into collection
// [1, 2, 2, 3] + odd => [odd:[1,3], even:[2,2]]
export function group_by(v, fn, ret = {}) {
	for (let x of v) {
		let key = fn(x);
		let g = ret[key];
		if (!g) g = ret[key] = [];
		g.push(x);
	}
	return ret;
}

export function tally(v, ret = {}) {
	for (let x of v) {
		ret[x] = (ret[x] ?? 0) + 1;
	}
	return ret;
}

// split list into runs where 
// [..., a, b, ...] => [[..., a], [b, ...]] if fn(a, b)
export function split_between(v, fn) {
	let start = 0;
	let ret = [];
	for (let i = 1; i < v.length; i++) {
		if (fn(v[i - 1], v[i])) {
			ret.push(v.slice(start, i));
			start = i;
		}
	}
	if (start < v.length) {
		ret.push(v.slice(start));
	}
	return ret;
}

// split an array on specific values
// [a, b, x, c, d] => [[a, b], [c, d]]
export function split_on(v, x) {
	let ret = [];
	let pos = 0;
	while (true) {
		let next = v.indexOf(x, pos);
		if (next == -1) break;
		ret.push(v.slice(pos, next));
		pos = next + 1;		
	}
	ret.push(v.slice(pos));
	return ret;
}