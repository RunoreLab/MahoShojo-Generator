import { time } from 'console';
import SensitiveWordFilter from '../lib/sensitive-word-filter';
import fs from 'fs';

// let content = "音色情感的任务";
// const filter = new SensitiveWordFilter();
// setTimeout(() => {
//     const result = filter.checkText(content);
//     console.log('sensitiveWord test result:', result.detectedWords);
// }, 500);
// const result = filter.checkText(content);
// console.log('sensitiveWord test result:', result.detectedWords);

// Read the test fixture as text and pass it to checkText (it expects a string)
fs.readFile('./tests/test.json', 'utf8', (err, data) => {
    if (err) throw err;

    const filter = new SensitiveWordFilter();
    const result = filter.checkText(data);

    // Basic assertion: result should be an object with isUnsafe boolean
    console.log('sensitiveWord test result:', result.detectedWords);
});