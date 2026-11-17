import express from 'express'
import 'dotenv/config'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT || 8000


app.use(express.json())
app.use(cors());



app.get('/', (req, res) => {
    res.send('Server is running')
})

app.listen(PORT, () => {
    console.log('Server is running at port', PORT)
})