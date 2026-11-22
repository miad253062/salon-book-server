import express from 'express'
import 'dotenv/config'
import cors from 'cors'
import { MongoClient, ObjectId } from 'mongodb';

const app = express()
const PORT = process.env.PORT || 8000

app.use(express.json())
app.use(cors());

const client = new MongoClient(`mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.eimgd93.mongodb.net/`);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB()
const database = connectedClient.db('salonbook-db')
const users = database.collection('user')
const services = database.collection('services')
const appointments = database.collection('appointments')
const transactions = database.collection('transactions')

app.get('/', (req, res) => {
    res.send('Server is running')
})

app.get('/services/feature', async(req, res) => {
    const query = {status: 'active'}
    const featuredData = await services.find(query).sort({price: -1}).limit(6).toArray()
    res.send(featuredData)
})

app.get('/services', async (req, res) => {
    console.log("Received Query:", req.query);
    const { category } = req.query;
    const query = category ? { category, status: 'active' } : {status: 'active'};
    const result = await services.find(query).toArray();
    res.send(result);
});

app.get('/services/:id', async(req, res) => {
    console.log('User Request for:', req.params.id)
    const id = req.params.id
    const singleData = await services.findOne({_id: new ObjectId(id)})
    if(!singleData) return res.status(404).send({message: 'Data not found!'})
    res.send(singleData)
})

app.post('/appointments', async(req, res) => {
    const data = req.body
    const query = {
        userId: data.userId,
        serviceId: data.serviceId,
        time: data.time,
        date: data.date

    }
    const exists = await appointments.findOne(query)
    console.log('exists', exists)
    if(exists) return res.status(409).send({message: 'Appointment already booked in this time'})
    const result = await appointments.insertOne(data)
    res.send(result)
})

app.get('/users/:userid/appointment', async(req, res) => {
    const {userid} = req.params
    console.log(userid, 'requests for appointments data')
    const query = {userId: userid}
    const result = await appointments.find(query).toArray()
    res.send(result)
})

app.patch('/appointments/:appointmentId/cancel', async(req, res) => {
    const {appointmentId} = req.params
    console.log('user wants to cancel the appointment', appointmentId)
    const finddata = {_id : new ObjectId(appointmentId)}
    const query = {$set: {status: 'canceled'}}
    const result = await appointments.updateOne(finddata, query)
    res.send(result)
})

app.patch('/appointments/:appointmentId/payment', async(req, res) => {
    const {appointmentId} = req.params
    if (!ObjectId.isValid(appointmentId)) return res.status(400).send({message: 'Invalid appointment id'})
    console.log('payment confirmed for appointment', appointmentId)

    const result = await appointments.updateOne(
        {_id: new ObjectId(appointmentId), status: 'confirmed', paymentStatus: {$ne: 'paid'}},
        {$set: {paymentStatus: 'paid', paidAt: new Date()}}
    )

    if (!result.matchedCount) return res.status(409).send({message: 'This appointment is not payable'})
    res.send({success: true, modifiedCount: result.modifiedCount})
})

app.post('/transactions', async(req, res) => {
    const data = req.body
    if (!data.sessionId) return res.status(400).send({message: 'sessionId is required'})

    const exists = await transactions.findOne({sessionId: data.sessionId})
    if (exists) return res.send({success: true, duplicate: true, transactionId: exists._id})

    const result = await transactions.insertOne({...data, createdAt: new Date()})
    console.log('transaction saved', result.insertedId)
    res.send({success: true, transactionId: result.insertedId})
})

app.get('/transactions/session/:sessionId', async(req, res) => {
    const {sessionId} = req.params
    const transaction = await transactions.findOne({
        $or: [{sessionId}, {transactionId: sessionId}]
    })
    if (!transaction) return res.status(404).send({message: 'Transaction not found'})
    res.send({transaction})
})


app.get('/admin/overview', async(req, res)=> {
    const totalCustomer = await users.countDocuments({role: 'customer'})
    const totalService = await services.countDocuments({status: 'active'})
    const totalAppointment = await appointments.countDocuments()
    const totalPending = await appointments.countDocuments({status: 'pending'})
    const totalConfirmed = await appointments.countDocuments({status: 'confirmed'})
    const successfullPayment = await transactions.find({status: 'succeeded'}, {projection: {amount: 1}}).toArray()
    console.log(successfullPayment)
    const totalSuccessfullPayment = successfullPayment.length
    const totalAmount = successfullPayment.reduce((acc, current) => { return current.amount + acc}, 0)
    console.log(totalAmount)

    const packed = {
        totalCustomer, 
        totalService, 
        totalAppointment,
        totalPending,
        totalConfirmed,
        payment: {
            success: totalSuccessfullPayment,
            totalAmount
        }
    }
    res.send(packed)
})

app.listen(PORT, () => {
    console.log('Server is running at port', PORT)
})