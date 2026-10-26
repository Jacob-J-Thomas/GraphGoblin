// SQLite runs only in this worker: its exit releases every native statement before the copy owner
// removes the files. An owner killed before sending `read` leaves no worker holding its copy.
import { readStoreFactsFromFile } from './store-facts.js';

process.once('disconnect', () => process.exit(1));
process.once('message', () => {
  void readStoreFactsFromFile(process.argv[2]!).then((facts) => {
    process.send!(facts, () => process.exit(0));
  });
});
