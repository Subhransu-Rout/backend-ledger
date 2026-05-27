const transactionModel = require("../models/transaction.model")
const ledgerModel = require("../models/ledger.model")
const accountModel = require("../models/account.model")
const emailService = require("../services/email.service")
const mongoose = require("mongoose")

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

    const session = await mongoose.startSession()

    try {

        /**
         * 1. Validate request
         */
        const {
            fromAccount,
            toAccount,
            amount,
            idempotencyKey
        } = req.body

        if (
            !fromAccount ||
            !toAccount ||
            !idempotencyKey
        ) {
            return res.status(400).json({
                message: "fromAccount, toAccount and idempotencyKey are required"
            })
        }

        /**
         * 2. Validate amount
         */
        if (
            typeof amount !== "number" ||
            amount <= 0
        ) {
            return res.status(400).json({
                message: "Amount must be a positive number"
            })
        }

        /**
         * 3. Prevent self transfer
         */
        if (fromAccount === toAccount) {
            return res.status(400).json({
                message: "Cannot transfer to same account"
            })
        }

        let transaction

        /**
         * 4. Start transaction
         */
        await session.withTransaction(async () => {

            /**
             * 5. Check idempotency INSIDE transaction
             */
            const existingTransaction =
                await transactionModel.findOne({
                    idempotencyKey
                }).session(session)

            if (existingTransaction) {

                if (existingTransaction.status === "COMPLETED") {

                    transaction = existingTransaction
                    return
                }

                if (existingTransaction.status === "PENDING") {
                    throw new Error("TRANSACTION_PENDING")
                }

                if (
                    existingTransaction.status === "FAILED" ||
                    existingTransaction.status === "REVERSED"
                ) {
                    throw new Error("TRANSACTION_RETRY")
                }
            }

            /**
             * 6. Fetch accounts inside transaction
             */
            const fromUserAccount =
                await accountModel.findById(fromAccount).session(session)

            const toUserAccount =
                await accountModel.findById(toAccount).session(session)

            if (!fromUserAccount || !toUserAccount) {
                throw new Error("INVALID_ACCOUNT")
            }

            /**
             * 7. Validate account status
             */
            if (
                fromUserAccount.status !== "ACTIVE" ||
                toUserAccount.status !== "ACTIVE"
            ) {
                throw new Error("ACCOUNT_NOT_ACTIVE")
            }

            /**
             * 8. Get balance INSIDE transaction
             */
            const balance =
                await fromUserAccount.getBalance(session)

            if (balance < amount) {
                throw new Error("INSUFFICIENT_BALANCE")
            }

            /**
             * 9. Create transaction
             */
            transaction = (
                await transactionModel.create([ {
                    fromAccount,
                    toAccount,
                    amount,
                    idempotencyKey,
                    status: "PENDING"
                } ], { session })
            )[ 0 ]

            /**
             * 10. Create debit ledger entry
             */
            await ledgerModel.create([ {
                account: fromAccount,
                amount,
                transaction: transaction._id,
                type: "DEBIT"
            } ], { session })

            /**
             * 11. Create credit ledger entry
             */
            await ledgerModel.create([ {
                account: toAccount,
                amount,
                transaction: transaction._id,
                type: "CREDIT"
            } ], { session })

            /**
             * 12. Mark transaction completed
             */
            transaction.status = "COMPLETED"

            await transaction.save({ session })

        })

        /**
         * 13. Handle already completed transaction
         */
        if (transaction.status === "COMPLETED") {

            /**
             * Send email asynchronously
             */
            emailService.sendTransactionEmail(
                req.user.email,
                req.user.name,
                amount,
                toAccount
            ).catch(err => {
                console.error("Email send failed:", err)
            })

            return res.status(201).json({
                message: "Transaction completed successfully",
                transaction
            })
        }

    } catch (error) {

        console.error(error)

        /**
         * Duplicate idempotency key
         */
        if (error.code === 11000) {
            return res.status(409).json({
                message: "Duplicate transaction request"
            })
        }

        switch (error.message) {

            case "INVALID_ACCOUNT":
                return res.status(400).json({
                    message: "Invalid fromAccount or toAccount"
                })

            case "ACCOUNT_NOT_ACTIVE":
                return res.status(400).json({
                    message:
                        "Both accounts must be ACTIVE"
                })

            case "INSUFFICIENT_BALANCE":
                return res.status(400).json({
                    message: "Insufficient balance"
                })

            case "TRANSACTION_PENDING":
                return res.status(409).json({
                    message: "Transaction is already processing"
                })

            case "TRANSACTION_RETRY":
                return res.status(409).json({
                    message: "Previous transaction failed. Retry allowed."
                })

            default:
                return res.status(500).json({
                    message: "Internal server error"
                })
        }

    } finally {
        await session.endSession()
    }
}

async function createInitialFundsTransaction(req, res) {
    const { toAccount, amount, idempotencyKey } = req.body

    if (!toAccount || !amount || !idempotencyKey) {
        return res.status(400).json({
            message: "toAccount, amount and idempotencyKey are required"
        })
    }

    const toUserAccount = await accountModel.findOne({
        _id: toAccount,
    })

    if (!toUserAccount) {
        return res.status(400).json({
            message: "Invalid toAccount"
        })
    }

    const fromUserAccount = await accountModel.findOne({
        user: req.user._id
    })

    if (!fromUserAccount) {
        return res.status(400).json({
            message: "System user account not found"
        })
    }


    const session = await mongoose.startSession()
    session.startTransaction()

    const transaction = new transactionModel({
        fromAccount: fromUserAccount._id,
        toAccount,
        amount,
        idempotencyKey,
        status: "PENDING"
    })

    const debitLedgerEntry = await ledgerModel.create([ {
        account: fromUserAccount._id,
        amount: amount,
        transaction: transaction._id,
        type: "DEBIT"
    } ], { session })

    const creditLedgerEntry = await ledgerModel.create([ {
        account: toAccount,
        amount: amount,
        transaction: transaction._id,
        type: "CREDIT"
    } ], { session })

    transaction.status = "COMPLETED"
    await transaction.save({ session })

    await session.commitTransaction()
    session.endSession()

    return res.status(201).json({
        message: "Initial funds transaction completed successfully",
        transaction: transaction
    })


}

module.exports = {
    createTransaction,
    createInitialFundsTransaction
}

