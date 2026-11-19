import express from 'express'
import 'dotenv/config'
import cors from 'cors'
import { MongoClient } from 'mongodb';

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
const services = database.collection('services')

app.get('/', (req, res) => {
    res.send('Server is running')
})

app.get('/services/feature', async(req, res) => {
    const query = {status: 'active'}
    const featuredData = await services.find(query).sort({price: -1}).limit(6).toArray()
    res.send(featuredData)
})

app.listen(PORT, () => {
    console.log('Server is running at port', PORT)
})