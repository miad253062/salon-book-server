import express from 'express'
import 'dotenv/config'
import cors from 'cors'
import { MongoClient, ObjectId } from 'mongodb'

const app = express()
const PORT = process.env.PORT || 8000

app.use(express.json())

const allowedOrigins = [
    process.env.CLIENT_ORIGIN,
    'https://salon-book-client-pjan.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
].filter(Boolean)

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true)
            return
        }
        callback(new Error('Origin not allowed by CORS'))
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
}))

const client = new MongoClient(`mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.eimgd93.mongodb.net/`)

export async function connectToMongoDB() {
    await client.connect()
    return client
}

const connectedClient = await connectToMongoDB()
const database = connectedClient.db('salonbook-db')
const users = database.collection('user')
const sessions = database.collection('session')
const services = database.collection('services')
const appointments = database.collection('appointments')
const transactions = database.collection('transactions')

const getUserIdVariants = (userDoc) => {
    const ids = []
    if (userDoc?._id) ids.push(userDoc._id.toString())
    if (userDoc?.id) ids.push(String(userDoc.id))
    return ids
}

const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).send({ message: 'Unauthorized: Missing token' })
        }

        const token = authHeader.split(' ')[1]
        if (!token) {
            return res.status(401).send({ message: 'Unauthorized: Invalid token format' })
        }

        const sessionDoc = await sessions.findOne({ token })
        if (!sessionDoc) {
            return res.status(401).send({ message: 'Unauthorized: Invalid session' })
        }

        if (new Date(sessionDoc.expiresAt) < new Date()) {
            return res.status(401).send({ message: 'Unauthorized: Session expired' })
        }

        const sessionUserId = sessionDoc.userId?.toString()
        const userFilter = ObjectId.isValid(sessionUserId)
            ? { $or: [{ _id: new ObjectId(sessionUserId) }, { id: sessionUserId }] }
            : { id: sessionUserId }

        const dbUser = await users.findOne(userFilter)
        if (!dbUser) {
            return res.status(401).send({ message: 'Unauthorized: User not found' })
        }

        if (dbUser.isBlocked) {
            return res.status(403).send({ message: 'Forbidden: Your account is blocked' })
        }

        req.user = dbUser
        next()
    } catch (error) {
        return res.status(401).send({ message: 'Unauthorized: Verification failed' })
    }
}

const verifyAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden: Admin access required' })
    }
    next()
}

const verifyCustomer = (req, res, next) => {
    const userRole = req.user?.role || 'customer'
    if (userRole !== 'customer') {
        return res.status(403).send({ message: 'Forbidden: Customer access required' })
    }
    next()
}

app.get('/', (req, res) => {
    res.send('Server is running')
})

app.get('/services/feature', async (req, res) => {
    const query = { status: 'active' }
    const featuredData = await services.find(query).sort({ price: -1 }).limit(6).toArray()
    res.send(featuredData)
})

app.get('/services', async (req, res) => {
    const { category } = req.query
    const query = category ? { category, status: 'active' } : { status: 'active' }
    const result = await services.find(query).toArray()
    res.send(result)
})

app.get('/services/:id', verifyToken, async (req, res) => {
    const { id } = req.params
    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid service ID!' })
    }
    const singleData = await services.findOne({ _id: new ObjectId(id) })
    if (!singleData) return res.status(404).send({ message: 'Data not found!' })
    res.send(singleData)
})

app.get('/admin/services', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const result = await services.find({}).toArray()
        res.send(result)
    } catch (error) {
        res.status(500).send({ message: 'Failed to fetch all services' })
    }
})

app.get('/admin/overview', verifyToken, verifyAdmin, async (req, res) => {
    const totalCustomer = await users.countDocuments({ role: 'customer' })
    const totalService = await services.countDocuments({ status: 'active' })
    const totalAppointment = await appointments.countDocuments()
    const totalPending = await appointments.countDocuments({ status: 'pending' })
    const totalConfirmed = await appointments.countDocuments({ status: 'confirmed' })
    const successfullPayment = await transactions.find({ status: 'succeeded' }, { projection: { amount: 1 } }).toArray()
    const totalSuccessfullPayment = successfullPayment.length
    const totalAmount = successfullPayment.reduce((acc, current) => current.amount + acc, 0)

    res.send({
        totalCustomer,
        totalService,
        totalAppointment,
        totalPending,
        totalConfirmed,
        payment: {
            success: totalSuccessfullPayment,
            totalAmount,
        },
    })
})

app.post('/appointments', verifyToken, verifyCustomer, async (req, res) => {
    try {
        const data = req.body
        const rawServiceId = data.serviceId || data.service?._id

        if (!rawServiceId || !ObjectId.isValid(rawServiceId)) {
            return res.status(400).send({ message: 'Invalid service ID' })
        }

        const activeService = await services.findOne({
            _id: new ObjectId(rawServiceId),
            status: 'active',
        })

        if (!activeService) {
            return res.status(400).send({ message: 'This service is currently unavailable' })
        }

        const duplicateQuery = {
            $or: [{ serviceId: rawServiceId }, { 'service._id': rawServiceId }],
            time: data.time,
            date: data.date,
            status: { $ne: 'canceled' },
        }

        const exists = await appointments.findOne(duplicateQuery)
        if (exists) {
            return res.status(409).send({ message: 'Appointment already booked in this time' })
        }

        const verifiedUserId = req.user.id || req.user._id.toString()
        const appointmentDoc = {
            ...data,
            userId: verifiedUserId,
            userEmail: req.user.email,
            status: 'pending',
            paymentStatus: 'unpaid',
        }

        const result = await appointments.insertOne(appointmentDoc)
        res.send(result)
    } catch (error) {
        res.status(500).send({ message: 'Failed to create appointment' })
    }
})

app.get('/users/:userid/appointment', verifyToken, verifyCustomer, async (req, res) => {
    const { userid } = req.params
    const allowedIds = getUserIdVariants(req.user)

    if (!allowedIds.includes(userid)) {
        return res.status(403).send({ message: 'Forbidden: Cannot access other user appointments' })
    }

    const result = await appointments.find({
        $or: [{ userId: { $in: allowedIds } }, { userEmail: req.user.email }],
    }).toArray()
    res.send(result)
})

app.patch('/appointments/:appointmentId/cancel', verifyToken, async (req, res) => {
    const { appointmentId } = req.params
    if (!ObjectId.isValid(appointmentId)) {
        return res.status(400).send({ message: 'Invalid appointment ID' })
    }

    const appointment = await appointments.findOne({ _id: new ObjectId(appointmentId) })
    if (!appointment) {
        return res.status(404).send({ message: 'Appointment not found' })
    }

    const userRole = req.user?.role || 'customer'
    if (userRole === 'customer') {
        const allowedIds = getUserIdVariants(req.user)
        const isOwner = allowedIds.includes(String(appointment.userId)) || appointment.userEmail === req.user.email

        if (!isOwner) {
            return res.status(403).send({ message: 'Forbidden: Cannot cancel another user appointment' })
        }
        if (appointment.status !== 'pending') {
            return res.status(400).send({ message: 'Only pending appointments can be canceled' })
        }
    } else if (userRole === 'admin') {
        if (!['pending', 'confirmed'].includes(appointment.status)) {
            return res.status(400).send({ message: 'Only pending or confirmed appointments can be canceled' })
        }
    } else {
        return res.status(403).send({ message: 'Forbidden: Unauthorized role' })
    }

    const result = await appointments.updateOne(
        { _id: new ObjectId(appointmentId) },
        { $set: { status: 'canceled', canceledAt: new Date() } }
    )
    res.send({ success: true, modifiedCount: result.modifiedCount })
})

app.patch('/appointments/:appointmentId/payment', verifyToken, verifyCustomer, async (req, res) => {
    const { appointmentId } = req.params
    if (!ObjectId.isValid(appointmentId)) {
        return res.status(400).send({ message: 'Invalid appointment id' })
    }

    const allowedIds = getUserIdVariants(req.user)
    const result = await appointments.updateOne(
        {
            _id: new ObjectId(appointmentId),
            $or: [{ userId: { $in: allowedIds } }, { userEmail: req.user.email }],
            status: 'confirmed',
            paymentStatus: { $ne: 'paid' },
        },
        { $set: { paymentStatus: 'paid', paidAt: new Date() } }
    )

    if (!result.matchedCount) {
        return res.status(409).send({ message: 'This appointment is not payable' })
    }
    res.send({ success: true, modifiedCount: result.modifiedCount })
})

app.post('/transactions', verifyToken, verifyCustomer, async (req, res) => {
    const data = req.body
    if (!data.sessionId) {
        return res.status(400).send({ message: 'sessionId is required' })
    }

    const exists = await transactions.findOne({ sessionId: data.sessionId })
    if (exists) {
        return res.send({ success: true, duplicate: true, transactionId: exists._id })
    }

    const verifiedUserId = req.user.id || req.user._id.toString()
    const transactionDoc = {
        ...data,
        customerId: data.customerId || verifiedUserId,
        customerEmail: req.user.email,
        createdAt: new Date(),
    }

    const result = await transactions.insertOne(transactionDoc)
    res.send({ success: true, transactionId: result.insertedId })
})

app.get('/transactions/session/:sessionId', verifyToken, async (req, res) => {
    const { sessionId } = req.params
    const transaction = await transactions.findOne({
        $or: [{ sessionId }, { transactionId: sessionId }],
    })
    if (!transaction) {
        return res.status(404).send({ message: 'Transaction not found' })
    }

    const userRole = req.user?.role || 'customer'
    if (userRole === 'customer' && transaction.customerEmail && transaction.customerEmail !== req.user.email) {
        return res.status(403).send({ message: 'Forbidden: Cannot view this transaction' })
    }

    res.send({ transaction })
})

app.delete('/service/delete/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: 'Invalid service ID!' })
        }
        const result = await services.deleteOne({ _id: new ObjectId(id) })
        if (result.deletedCount === 0) {
            return res.status(404).send({ message: 'Service not found!' })
        }

        res.send({ success: true, deletedCount: result.deletedCount })
    } catch (error) {
        res.status(500).send({ message: 'Failed to delete service' })
    }
})

app.patch('/service/update/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: 'Invalid service ID!' })
        }

        const { _id, ...updatedData } = req.body
        if (updatedData.price !== undefined && Number(updatedData.price) <= 0) {
            return res.status(400).send({ message: 'Price must be a positive number' })
        }
        if (updatedData.duration !== undefined && Number(updatedData.duration) <= 0) {
            return res.status(400).send({ message: 'Duration must be a positive number' })
        }

        const result = await services.updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    ...updatedData,
                    updatedAt: new Date(),
                },
            }
        )

        if (result.matchedCount === 0) {
            return res.status(404).send({ message: 'Service not found!' })
        }

        res.send({
            success: true,
            modifiedCount: result.modifiedCount,
        })
    } catch (error) {
        res.status(500).send({ message: 'Failed to update service' })
    }
})

app.get('/admin/appointments', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const result = await appointments.find({}).sort({ _id: -1 }).toArray()
        res.send(result)
    } catch (error) {
        res.status(500).send({ message: 'Failed to fetch appointments' })
    }
})

app.patch('/admin/confirm_appointment/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: 'Invalid appointment ID!' })
        }

        const result = await appointments.updateOne(
            { _id: new ObjectId(id), status: 'pending' },
            {
                $set: {
                    status: 'confirmed',
                    confirmedAt: new Date(),
                },
            }
        )
        if (result.matchedCount === 0) {
            return res.status(404).send({
                message: 'Pending appointment not found or already processed!',
            })
        }

        res.send(result)
    } catch (error) {
        res.status(500).send({ message: 'Failed to confirm appointment' })
    }
})

app.post('/service/add', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const {
            name,
            category,
            description,
            price,
            duration,
            image,
            status,
        } = req.body

        const parsedPrice = Number(price)
        const parsedDuration = Number(duration)

        if (!name?.trim() || !category?.trim() || !parsedPrice || parsedPrice <= 0 || !parsedDuration || parsedDuration <= 0) {
            return res.status(400).send({ message: 'Valid name, category, positive price and duration are required' })
        }

        const newService = {
            name: name.trim(),
            category: category.trim(),
            description: description?.trim() || '',
            price: parsedPrice,
            duration: parsedDuration,
            image: image?.trim() || '',
            status: status || 'active',
            addedBy: {
                name: req.user.name,
                email: req.user.email,
                role: req.user.role,
            },
            createdAt: new Date(),
        }

        const result = await services.insertOne(newService)

        res.status(201).send({
            success: true,
            insertedId: result.insertedId,
        })
    } catch (error) {
        res.status(500).send({ message: 'Failed to add service' })
    }
})

app.get('/customer/overview/:email', verifyToken, verifyCustomer, async (req, res) => {
    const { email } = req.params
    if (email !== req.user.email) {
        return res.status(403).send({ message: 'Forbidden: Cannot view another user overview' })
    }

    const totalAppointmentByCustomer = await appointments.countDocuments({ userEmail: email })
    const pendingAppointment = await appointments.countDocuments({ userEmail: email, status: 'pending' })
    const confirmedAppointment = await appointments.countDocuments({ userEmail: email, status: 'confirmed' })
    const cancelledAppointment = await appointments.countDocuments({ userEmail: email, status: 'canceled' })

    res.send({
        totalAppointmentByCustomer,
        pendingAppointment,
        confirmedAppointment,
        cancelledAppointment,
    })
})

app.get('/admin/allusers', verifyToken, verifyAdmin, async (req, res) => {
    const result = await users.find({}).toArray()
    res.send(result)
})

app.patch('/admin/users/:userid/status', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { userid } = req.params
        const { isBlocked } = req.body
        const baseFilter = ObjectId.isValid(userid)
            ? { $or: [{ _id: new ObjectId(userid) }, { id: userid }] }
            : { id: userid }

        const filter = isBlocked
            ? { ...baseFilter, role: { $ne: 'admin' } }
            : baseFilter

        const result = await users.updateOne(filter, {
            $set: { isBlocked, updatedAt: new Date() },
        })

        if (result.matchedCount === 0) {
            return res.status(404).send({
                message: isBlocked
                    ? 'User not found or cannot block an admin!'
                    : 'User not found!',
            })
        }
        res.send({
            success: true,
            isBlocked,
            modifiedCount: result.modifiedCount,
        })
    } catch (error) {
        res.status(500).send({ message: 'Failed to update user status' })
    }
})

app.get('/admin/transactions', verifyToken, verifyAdmin, async (req, res) => {
    const result = await transactions.find({}).toArray()
    res.send(result)
})

app.listen(PORT)

export default app