import { DB_TIMEOUT, ErrorMessage } from '@celo/phone-number-privacy-common'
import Logger from 'bunyan'
import { Counters, Histograms, Labels } from '../../common/metrics'
import { getDatabase } from '../database'
import { Account, ACCOUNTS_COLUMNS, ACCOUNTS_TABLE } from '../models/account'

function accounts() {
  return getDatabase()<Account>(ACCOUNTS_TABLE)
}

/*
 * Returns how many queries the account has already performed.
 */
export async function getPerformedQueryCount(account: string, logger: Logger): Promise<number> {
  logger.debug({ account }, 'Getting performed query count')
  const getPerformedQueryCountMeter = Histograms.dbOpsInstrumentation
    .labels('getPerformedQueryCount')
    .startTimer()
  try {
    const queryCounts = await accounts()
      .select(ACCOUNTS_COLUMNS.numLookups)
      .where(ACCOUNTS_COLUMNS.address, account)
      .first()
    getPerformedQueryCountMeter()
    return queryCounts === undefined ? 0 : queryCounts[ACCOUNTS_COLUMNS.numLookups]
  } catch (err) {
    Counters.databaseErrors.labels(Labels.read).inc()
    logger.error(ErrorMessage.DATABASE_GET_FAILURE)
    logger.error(err)
    getPerformedQueryCountMeter()
    return 0
  }
}

async function getAccountExists(account: string): Promise<boolean> {
  const getAccountExistsMeter = Histograms.dbOpsInstrumentation
    .labels('getAccountExists')
    .startTimer()
  const existingAccountRecord = await accounts().where(ACCOUNTS_COLUMNS.address, account).first()
  getAccountExistsMeter()
  return !!existingAccountRecord
}

/*
 * Increments query count in database.  If record doesn't exist, create one.
 */
async function _incrementQueryCount(account: string, logger: Logger) {
  logger.debug({ account }, 'Incrementing query count')
  try {
    if (await getAccountExists(account)) {
      await accounts()
        .where(ACCOUNTS_COLUMNS.address, account)
        .increment(ACCOUNTS_COLUMNS.numLookups, 1)
      return true
    } else {
      const newAccount = new Account(account)
      newAccount[ACCOUNTS_COLUMNS.numLookups] = 1
      return insertRecord(newAccount)
    }
  } catch (err) {
    Counters.databaseErrors.labels(Labels.update).inc()
    logger.error(ErrorMessage.DATABASE_UPDATE_FAILURE)
    logger.error(err)
    return null
  }
}

export async function incrementQueryCount(account: string, logger: Logger) {
  const incrementQueryCountMeter = Histograms.dbOpsInstrumentation
    .labels('incrementQueryCount')
    .startTimer()
  return _incrementQueryCount(account, logger).finally(incrementQueryCountMeter)
}

/*
 * Returns whether account has already performed matchmaking
 */
async function _getDidMatchmaking(account: string, logger: Logger): Promise<boolean> {
  try {
    const didMatchmaking = await accounts()
      .where(ACCOUNTS_COLUMNS.address, account)
      .select(ACCOUNTS_COLUMNS.didMatchmaking)
      .first()
    if (!didMatchmaking) {
      return false
    }
    return !!didMatchmaking[ACCOUNTS_COLUMNS.didMatchmaking]
  } catch (err) {
    Counters.databaseErrors.labels(Labels.update).inc()
    logger.error(ErrorMessage.DATABASE_UPDATE_FAILURE)
    logger.error(err)
    return false
  }
}

export async function getDidMatchmaking(account: string, logger: Logger) {
  const getDidMatchmakingMeter = Histograms.dbOpsInstrumentation
    .labels('getDidMatchmaking')
    .startTimer()
  return _getDidMatchmaking(account, logger).finally(getDidMatchmakingMeter)
}

/*
 * Set did matchmaking to true in database.  If record doesn't exist, create one.
 */
async function _setDidMatchmaking(account: string, logger: Logger) {
  logger.debug({ account }, 'Setting did matchmaking')
  try {
    if (await getAccountExists(account)) {
      return accounts()
        .where(ACCOUNTS_COLUMNS.address, account)
        .update(ACCOUNTS_COLUMNS.didMatchmaking, new Date()) // TODO(Alec): add timeouts here?
    } else {
      const newAccount = new Account(account)
      newAccount[ACCOUNTS_COLUMNS.didMatchmaking] = new Date()
      return insertRecord(newAccount)
    }
  } catch (err) {
    Counters.databaseErrors.labels(Labels.update).inc()
    logger.error(ErrorMessage.DATABASE_UPDATE_FAILURE)
    logger.error(err)
    return null
  }
}

export async function setDidMatchmaking(account: string, logger: Logger) {
  const setDidMatchmakingMeter = Histograms.dbOpsInstrumentation
    .labels('setDidMatchmaking')
    .startTimer()
  return _setDidMatchmaking(account, logger).finally(setDidMatchmakingMeter)
}

async function insertRecord(data: Account) {
  await accounts().insert(data).timeout(DB_TIMEOUT)
  return true
}
