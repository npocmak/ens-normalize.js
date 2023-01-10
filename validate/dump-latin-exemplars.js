import {PRINTER} from '../derive/unicode-version.js';
import {explode_cp, hex_cp, print_table} from '../derive/utils.js';
import {ens_normalize, ens_tokenize, nfc} from '../src/lib.js';

// https://unicode-org.github.io/cldr-staging/charts/latest/by_type/core_data.alphabetic_information.main.html
// ALL latin exemplar characters
let chars = [
	'a','á','à','ă','ắ','ằ','ẵ','ẳ','â','ấ',
	'ầ','ẫ','ẩ','ǎ','å','ä','ã','a̧','ą','ā',
	'a᷆','a᷇','ả','ạ','ặ','ậ','a̱','æ','b','ɓ',
	'c','ć','ĉ','č','ċ','ç','d','ď','đ','ḍ',
	'ð','ɖ','ɗ','e','é','è','ê','ế','ề','ễ',
	'ể','ě','ë','ẽ','ė','ę','ē','e᷆','e᷇','ẻ',
	'ẹ','ẹ́','ẹ̀','ệ','e̱','ǝ','ǝ́','ǝ̂','ǝ̌','ǝ̄',
	'ə','ə́','ə̀','ə̂','ə̌','ɛ','ɛ́','ɛ̀','ɛ̂','ɛ̌',
	'ɛ̈','ɛ̃','ɛ̧','ɛ̄','ɛ᷆','ɛ᷇','ɛ̱','ɛ̱̈','f','ƒ',
	'g','ğ','ĝ','ǧ','ġ','ģ','ǥ','ɣ','h','ĥ',
	'ȟ','ħ','ḥ','ʻ','i','I','í','ì','î','ǐ',
	'ï','ĩ','İ','i̧','į','ī','i᷆','i᷇','ỉ','ị',
	'i̱','ı','ɨ','ɨ̀','ɨ̂','ɨ̌','ɨ̄','j','ĵ','k',
	'ǩ','ķ','ƙ','l','ĺ','ľ','ļ','ł','ḷ','m',
	'ḿ','m̀','m̄','n','ń','ǹ','ň','ñ','ṅ','ņ',
	'n̄','ɲ','ŋ','ŋ́','ŋ̀','ŋ̄','o','ó','ò','ô',
	'ố','ồ','ỗ','ổ','ǒ','ö','ő','õ','ø','ō',
	'o᷆','o᷇','ỏ','ơ','ớ','ờ','ỡ','ở','ợ','ọ',
	'ọ́','ọ̀','ộ','o̱','œ','ɔ','ɔ́','ɔ̀','ɔ̂','ɔ̌',
	'ɔ̈','ɔ̃','ɔ̧','ɔ̄','ɔ᷆','ɔ᷇','ɔ̱','p','q','r',
	'ŕ','ř','ṛ','s','ś','ŝ','š','ş','ṣ','ș',
	'ß','t','ť','ṭ','ț','ŧ','u','ú','ù','ŭ',
	'û','ǔ','ů','ü','ű','ũ','u̧','ų','ū','u᷆',
	'u᷇','ủ','ư','ứ','ừ','ữ','ử','ự','ụ','ʉ',
	'ʉ́','ʉ̀','ʉ̂','ʉ̌','ʉ̈','ʉ̄','v','ṽ','ʋ','w',
	'ʷ','ẃ','ẁ','ŵ','ẅ','x','y','ý','ỳ','ŷ',
	'ÿ','ỹ','ỷ','ỵ','ƴ','z','ź','ž','ż','ẓ',
	'ʒ','ǯ','þ','ʔ'
];

print_table(['Norm', 'Hex', 'Form', 'Name'], chars.map(ch => {
	let cps = nfc(explode_cp(ch));
	let form = String.fromCodePoint(...cps);
	let tokens = ens_tokenize(form);
	let norm;
	try {
		norm = ens_normalize(form);
		if (norm !== form) {
			norm = false;
		}
	} catch (err) {
	}
	return [norm ? 'X' : '', cps.map(hex_cp).join(' '), form, PRINTER.names(cps)]
}));