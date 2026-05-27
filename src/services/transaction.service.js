async function processTransaction({
    fromAccount,
    toAccount,
    amount,
    idempotencyKey,
    skipBalanceCheck = false
}) {

    const session = await mongoose.startSession()

    let transaction

    try {

        await session.withTransaction(async () => {

            /**
             * Idempotency
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
                    throw new Error(
                        "TRANSACTION_PENDING"
                    )
                }

                if (existingTransaction.status === "FAILED" || existingTransaction.status === "REVERSED") {
                    throw new Error(
                        "TRANSACTION_RETRY"
                    )
                }
            }

            /**
             * Accounts
             */
            const fromUserAccount =
                await accountModel.findById(
                    fromAccount
                ).session(session)

            const toUserAccount =
                await accountModel.findById(
                    toAccount
                ).session(session)

            if (
                !fromUserAccount ||
                !toUserAccount
            ) {
                throw new Error("INVALID_ACCOUNT")
            }

            /**
             * Status validation
             */
            if (
                fromUserAccount.status !== "ACTIVE" ||
                toUserAccount.status !== "ACTIVE"
            ) {
                throw new Error(
                    "ACCOUNT_NOT_ACTIVE"
                )
            }

            /**
             * Balance validation
             */
            if (!skipBalanceCheck) {

                const balance =
                    await fromUserAccount.getBalance(
                        session
                    )

                if (balance < amount) {
                    throw new Error(
                        "INSUFFICIENT_BALANCE"
                    )
                }
            }

            /**
             * Create transaction
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
             * Debit entry
             */
            await ledgerModel.create([ {
                account: fromAccount,
                amount,
                transaction: transaction._id,
                type: "DEBIT"
            } ], { session })

            /**
             * Credit entry
             */
            await ledgerModel.create([ {
                account: toAccount,
                amount,
                transaction: transaction._id,
                type: "CREDIT"
            } ], { session })

            /**
             * Complete transaction
             */
            transaction.status = "COMPLETED"

            await transaction.save({ session })

        })

        return transaction

    } finally {

        await session.endSession()

    }
}

module.exports = processTransaction