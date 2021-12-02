import {ens_normalize} from '../ens-normalize.js';

ens_normalize('🚴‍♂️.eth');

console.log(expect_throw(() => ens_normalize('_')));
console.log(ens_normalize('_', true) === '');

console.log('OK');

function expect_throw(fn) {
	try {fn();
	} catch (err) {
		return err.message;
	}
	throw new Error('expected throw');
}