const transactionModel = require("../models/transaction.model");
const ledgerModel = require("../models/ledger.model");
const accountModel = require("../models/account.model");
const emailService = require("../services/email.service");
const processTransaction = require('../services/transaction.service');
const handleTransactionError = require('../utils/handleTransactionError');
const mongoose = require("mongoose");

/**
 * - Create a new transaction
 * THE 10-STEP TRANSFER FLOW:
     * 1. Validate request
     * 2. Validate idempotency key
     * 3. Check account status
     * 4. Derive sender balance from ledger
     * 5. Create transaction (PENDING)
     * 6. Create DEBIT ledger entry
     * 7. Create CREDIT ledger entry
     * 8. Mark transaction COMPLETED
     * 9. Commit MongoDB session
     * 10. Send email notification
 */


async function createTransaction(req, res) {

    try {

        const {
            fromAccount,
            toAccount,
            amount,
            idempotencyKey
        } = req.body

        const transaction =
            await processTransaction({
                fromAccount,
                toAccount,
                amount,
                idempotencyKey
            })

        return res.status(201).json({
            message: "Transaction completed",
            transaction
        })

    } catch (error) {
        return handleTransactionError(error,res)
    }
}


async function createInitialFundsTransaction(req,res) {
    try {

        const {
            toAccount,
            amount,
            idempotencyKey
        } = req.body

        const systemAccount =
            await accountModel.findOne({
                user: req.user._id
            })

        const transaction =
            await processTransaction({
                fromAccount: systemAccount._id,
                toAccount,
                amount,
                idempotencyKey,
                skipBalanceCheck: true
            })

        return res.status(201).json({
            message: "Initial funds transaction completed",
            transaction
        })

    } catch (error) {
        return handleTransactionError(error,res);
    }
}

module.exports = {
    createTransaction,
    createInitialFundsTransaction
}

