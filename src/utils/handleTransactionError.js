function handleTransactionError(error, res) {

    if (error.code === 11000) {
        return res.status(409).json({
            message: "Duplicate transaction request"
        })
    }

    switch (error.message) {

        case "INVALID_ACCOUNT":
            return res.status(400).json({
                message: "Invalid account"
            })

        case "ACCOUNT_NOT_ACTIVE":
            return res.status(400).json({
                message: "Account must be ACTIVE"
            })

        case "INSUFFICIENT_BALANCE":
            return res.status(400).json({
                message: "Insufficient balance"
            })

        case "TRANSACTION_PENDING":
            return res.status(409).json({
                message: "Transaction already processing"
            })

        default:
            return res.status(500).json({
                message: "Internal server error"
            })
    }
}