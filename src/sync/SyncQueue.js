import { CHANGE_TYPES, generateUUID } from '../database';
const { CREATE, UPDATE, DELETE } = CHANGE_TYPES;
const recordTypesSynced = [
  'ItemLine',
  'Requisition',
  'RequisitionLine',
  'Stocktake',
  'StocktakeLine',
  'Transaction',
  'TransactionLine',
];

/**
 * Maintains the queue of records to be synced: listens to database changes,
 * queues sync records, provides them when asked, and removes them when marked as
 * used. First changed first out, i.e. the oldest changes are synced first.
 */
export class SyncQueue {
  constructor(database) {
    this.database = database;
    this.onDatabaseEvent = this.onDatabaseEvent.bind(this);
    this.databaseListenerId = null;
  }

  /**
   * Start the queue listening to database changes
   * @return {none}
   */
  enable() {
    this.databaseListenerId = this.database.addListener(this.onDatabaseEvent);
  }

  /**
   * Stop the queue listening to database changes
   * @return {none}
   */
  disable() {
    this.database.removeListener(this.databaseListenerId);
  }

  /**
   * Respond to a database change event. Must be called from within a database
   * write transaction.
   * @param  {string} changeType The type of database change, e.g. CREATE, UPDATE, DELETE
   * @param  {string} recordType The type of record changed (from database schema)
   * @param  {object} record     The record changed
   * @return {none}
   */
  onDatabaseEvent(changeType, recordType, record) {
    if (recordTypesSynced.indexOf(recordType) >= 0) {
      switch (changeType) {
        case CREATE:
        case UPDATE:
        case DELETE: {
          if (!record.id) return;
          const duplicate = this.database.objects('SyncOut')
                              .filtered(
                                'changeType == $0 && recordType == $1 && recordId == $2',
                                changeType,
                                recordType,
                                record.id)
                              .length > 0;
          if (!duplicate) {
            this.database.create(
              'SyncOut',
              {
                id: generateUUID(),
                changeTime: new Date().getTime(),
                changeType: changeType,
                recordType: recordType,
                recordId: record.id,
              });
          }
          break;
        }
        default: // Not a supported database event, do nothing. E.g. WIPE (takes care of itself)
          break;
      }
    }
  }

  /**
   * Return the number of records in the sync queue.
   * @return {integer} Number of records awaiting sync
   */
  length() {
    return this.database.objects('SyncOut').length;
  }

  /**
   * Return the next x records to be synced.
   * @param  {integer}   numberOfRecords The number of records to return (defaults to 1)
   * @return {array}                     An array of the top x records in the sync queue
   */
  next(numberOfRecords) {
    const numberToReturn = numberOfRecords || 1;
    const allRecords = this.database.objects('SyncOut').sorted('changeTime');
    return allRecords.slice(0, numberToReturn);
  }

  /**
   * Remove the given records from the sync queue.
   * @param  {array} records An array of the records that have been used
   * @return {none}
   */
  use(records) {
    this.database.write(() => {
      records.forEach((record) => {
        if (!record.isValid()) return; // Already deleted
        this.database.delete(record);
      });
    });
  }
}
