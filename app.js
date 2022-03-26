const Express = require("express");
const jwt = require("jsonwebtoken");
const BodyParser = require("body-parser");
const MongoClient = require("mongodb").MongoClient;
const ObjectId = require("mongodb").ObjectID;
const CONNECTION_URL = 'mongodb+srv://arkdev:EfFkZgVwOYUqKeiR@development-cluster.6b6qm.gcp.mongodb.net/test?retryWrites=true&w=majority';
//const CONNECTION_URL = 'mongodb://localhost:27017/topvotelocal';//'mongodb://34.66.30.3:27017/topvotelocal'; // // // 
const DATABASE_NAME = "test";
const Multer = require("multer");
const Bcrypt = require("bcryptjs");
var path=require('path');
const requestIp = require('request-ip');
const MANDRILL_API_KEY = process.env.MANDRILL_API_KEY || 'Jy0mGHxflPc72qgiBGiPCg';
const mandrill = new (require('mandrill-api')).Mandrill(MANDRILL_API_KEY);
const {Storage} = require('@google-cloud/storage');

const FROM_EMAIL = process.env.FROM_EMAIL || 'info@gettopvote.com';
const FROM_DISPLAY_EMAIL = process.env.FROM_DISPLAY_EMAIL || 'info@gettopvote.com';
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || 'info@gettopvote.com';
const gcsMiddlewares = require('./middlewares/google-cloud-storage');
const moment = require('moment');

const stripe = require('stripe')('sk_test_PepZGxgx1lnfWTETUMsUHuQY');

// configuring Multer to use files directory for storing files
// // this is important because later we'll need to access file path
// const storage = multer.diskStorage({
//     destination: './files',
//     filename(req, file, cb) {
//       cb(null, `${file.originalname}`);
//     },
//   });

const upload = Multer({
    storage: Multer.MemoryStorage,
    limits: {
        fileSize: 10 * 1024 * 1024, // Maximum file size is 10MB
    },
}); 
  
// const upload = multer({ storage });

var app = Express();
var cors = require('cors');
app.use(Express.static(__dirname + '/files'));
app.use(cors());
app.use(BodyParser.json());
app.use(BodyParser.urlencoded({ extended: true }));

const GOOGLE_CLOUD_PROJECT_ID = 'topvote'; // Replace with your project ID
const GOOGLE_CLOUD_KEYFILE = './config/topvote-a892fb20b980.json'; // Replace with the path to the downloaded private key
  
const storage = new Storage({
  
  projectId: GOOGLE_CLOUD_PROJECT_ID,
  
  keyFilename: GOOGLE_CLOUD_KEYFILE,
  
});

var database, collection;

app.listen(8080, () => {
    MongoClient.connect(CONNECTION_URL, { useNewUrlParser: true }, (error, client) => {
        if(error) {
            throw error;
        }
        database = client.db(DATABASE_NAME);
        collection = database.collection("campaigns");
        console.log("Connected to `" + DATABASE_NAME + "`!");
    });
});


const sendMandrillEmail = async (text, html, subject, toEmails, attachments) => {
    try {
      const message = {
        text,
        html,
        subject,
        from_email: FROM_EMAIL,
        from_name: FROM_DISPLAY_EMAIL,
        attachments: (attachments || []),
        to: toEmails || []
        // to: [
        //   { email : "kapil.pundit@gmail.com"}
        // ]
      };
      console.log("Hi" + JSON.stringify(message.to));
      let isSent = await mandrill.messages.send({ message, async: false }, function(result){
        console.log("Hi" + JSON.stringify(result));
      })
      
    } catch (error) {
      console.log("Hi" + error);
      logger.error(`competitions::sendMandrillEmail => ${error}`);
    }
};
  

//app.post("/campaign", upload.single('file'), (request, response) => {
app.post("/campaignTest", (request, response) => {
    //request.body.img = request.file.filename;
    request.body.options = [];
    request.body.emailRequired = (request.body.emailRequired == 'Yes') ? true : false;
    collection.insert(request.body, (error, result) => {
        if(error) {
            return response.status(500).send(error);
        }
        response.send(result.ops[0]._id);
    });
});

app.post("/campaign", upload.single('file'), gcsMiddlewares.sendUploadToGCS, (request, response) => {
    //app.post("/campaign", (request, response) => {
        if (request.file && request.file.gcsUrl) {
          request.body.img = request.file.gcsUrl;
        }
        
        request.body.options = [];
        request.body.emailRequired = (request.body.emailRequired == 'Yes') ? true : false;
        if (typeof request.body.campaignId === "undefined") {
          collection.insert(request.body, (error, result) => {
            if(error) {
                return response.status(500).send(error);
            }
            console.log(result)
            response.send(result.ops[0]._id);
          });
        } else {
          
          var ObjectId = require('mongodb').ObjectId; 
          var docId = new ObjectId(request.body.campaignId);
          collection.update({_id: docId }, { $set: {
            name: request.body.name,
            sport: request.body.sport,
            voting: request.body.voting,
            color: request.body.color,
            startDate: request.body.startDate,
            endDate: request.body.endDate,
            emailRequired: request.body.emailRequired,
            size: request.body.size,
            img: request.body.img
          }}, (error, result) => {
            if(error) {
                return response.status(500).send(error);
            }
            response.send(request.body.campaignId);
          });
        }
     });


app.get("/getQuestion", (request, response) => {
    var docId = request.query.id;
    var ObjectId = require('mongodb').ObjectId; 
    var docId = new ObjectId(docId);
    console.log(docId)
    collection.findOne({_id: docId}).then(function(result){
        console.log("result" + JSON.stringify(result));
        response.send(result);
    });
});

app.get("/testingRoute", (request, response) => {
    //console.log("result" + JSON.stringify(result));
    let result = "API is working"
    response.send(result);
});

app.post("/campaignSubmit", async (request, response) => {
    
    var ObjectId = require('mongodb').ObjectId; 
    var docId = new ObjectId(request.body.id);
    const clientIp = requestIp.getClientIp(request);
    console.log('ip address=' + clientIp)
    return collection.findOne({_id: docId, options: { $elemMatch: 
      { $or: [{emailAddress: request.body.email},{ipAddress: clientIp}]}}}).then(async function(document){
      if (document !== null) {
          var error = {};
          error.message = "This email address or system is already used for voting."
          return response.status(201).send(error);
      } else {
        const votes = await collection.aggregate([
          {
            $match: {
             // options: { $not: { $size: 0}}
              _id: docId
            }
          },
          { $unwind: "$options" },
          {
              $group: {
                  _id: {$toLower: '$options.choosenOption'},
                  count: { $sum: 1 }
              }
          }
        ])
        .toArray();
  
        let totalVotes = 0;
        votes.map((vote, index) => {
          totalVotes += vote.count;
        })
        
        let selectedOption = {
            choosenOption: request.body.choosenOption,
            ipAddress: clientIp,
            emailAddress: request.body.email
        }
        const votesResult = { votes: votes, totalVotes: totalVotes }
    
        return collection.findOne({_id: docId}).then(function(document){
            if (document !== null) {
                console.log('document found' + document.options)
                document.options.push(selectedOption)
                collection.save(document).then( result => {
                response.send(votesResult);
                });
            } else {
                var error = {};
                error.message = "This campaign does not exist now."
                return response.status(500).send(error);
            }
        });
          
      }
  })
});

app.post("/signup", cors(), (request, response) => {
    collection = database.collection("partners");
    let passCode = Math.floor(Math.random() * 90000) + 10000;
    request.body.password = passCode
    request.body.passCode = passCode // first time password
    request.body.status = 0
    return collection.findOne({email: request.body.email}).then(function(result){
        if (result === null) {
            collection.insert(request.body, (error, result) => {
                try {
              
                  let userEmail = request.body.email;
              
                  const paragraphs = [];
                  paragraphs.push('Hello '+request.body.name+',');
                  paragraphs.push('Your account has been created.');
                  paragraphs.push('Following are your login credentials:');
                  paragraphs.push('Email : ' + userEmail);
                  paragraphs.push('Password : ' + passCode);
                  paragraphs.push('Thank You');
              
                  let emailMessage = '';
                  let emailMessageHTML = '';
                  for (let i = 0; i < paragraphs.length; i += 1) {
                    emailMessage = `${emailMessage} ${paragraphs[i]} + \n\n`;
                    emailMessageHTML = `${emailMessageHTML} <p>${paragraphs[i]}</p>`;
                  }
              
                  const emails = [];
                  emails.push({ email: userEmail });
                  // return response.json(200, emailMessage);
                  sendMandrillEmail(emailMessage, emailMessageHTML, 'Topvote partner account', emails);
                  response.send(result.result);
                  //return response.json(200, partner);
                } catch (error) {
                    return response.status(500).send(error);
                }
            });
        } else {
            var error = {};
            error.code = 'EmailExist';
            error.message = "This email address already exist."
            return response.status(201).send(error);
        }
    });
});

app.get("/campaign", (request, response) => {
    collection.find({}).toArray((error, result) => {
        if(error) {
            return response.status(500).send(error);
        }
        response.send(result);
    });
});

app.get("/result", (request, response) => {
    collection.aggregate([
          {
            $match: {
             // options: { $not: { $size: 0}}
              _id: ObjectId('5ee24c979ecceb2c3857eae7')
            }
          },
          { $unwind: "$options" },
          {
              $group: {
                  _id: {$toLower: '$options'},
                  count: { $sum: 1 }
              }
          }
        ])
        .toArray((error, result) => {
            if(error) {
                return response.status(500).send(error);
            }
            response.send(result);
        });  
});

app.post('/createCustomer', async (req, res) => {
    // Create a new customer object
    console.log(JSON.stringify(JSON.stringify(req.body.data.formValues.email)))
    const customer = await stripe.customers.create({
      email: req.body.data.formValues.email,
    });
  
    // save the customer.id as stripeCustomerId
    // in your database.
    res.send({ customer });
});

// Set your secret key. Remember to switch to your live secret key in production!
// See your keys here: https://dashboard.stripe.com/account/apikeys

app.post('/createSubscription', async (req, res) => {
  console.log('createSubscription req' + JSON.stringify(req.body))
  // Attach the payment method to the customer
  try {
    await stripe.paymentMethods.attach(req.body.paymentMethodId, {
      customer: req.body.customerId,
    });
  } catch (error) {
    return res.status('402').send({ error: { message: error.message } });
  }

  // Change the default invoice settings on the customer to the new payment method
  await stripe.customers.update(
    req.body.customerId,
    {
      invoice_settings: {
        default_payment_method: req.body.paymentMethodId,
      },
    }
  );
  let trailEnd = moment().add(7, 'days').valueOf();  
  trailEndTimestamp = ~~(new Date(trailEnd).getTime() / 1000);
  // Create the subscription
  const subscription = await stripe.subscriptions.create({
    customer: req.body.customerId,
    items: [{ price: 'price_1H0AKqFZ4d6vrNTy56If9EPi' }],
    trial_end: trailEndTimestamp,//1594374467,
    expand: ['latest_invoice.payment_intent'],
  });

  collection = database.collection("partners");
    let passCode = Math.floor(Math.random() * 90000) + 10000;
    //req.body.password = passCode
    //req.body.passCode = passCode // first time password
    req.body.password = Bcrypt.hashSync(req.body.password, 10);
    return collection.insert(req.body, (error, result) => {
          try {
        
            let userEmail = req.body.email;
        
            const paragraphs = [];
            paragraphs.push('Hello '+req.body.name+',');
            paragraphs.push('Your account has been created.');
            paragraphs.push('Following are your login credentials:');
            paragraphs.push('Email : ' + userEmail);
            paragraphs.push('Password : ' + passCode);
            paragraphs.push('Thank You');
        
            let emailMessage = '';
            let emailMessageHTML = '';
            for (let i = 0; i < paragraphs.length; i += 1) {
              emailMessage = `${emailMessage} ${paragraphs[i]} + \n\n`;
              emailMessageHTML = `${emailMessageHTML} <p>${paragraphs[i]}</p>`;
            }
        
            const emails = [];
            emails.push({ email: userEmail });
            // return response.json(200, emailMessage);
            sendMandrillEmail(emailMessage, emailMessageHTML, 'Topvote partner account', emails);
            res.send(subscription);
            //res.send(result.result);
            //return response.json(200, partner);
          } catch (error) {
              return response.status(500).send(error);
          }
      });
    
});


app.post("/isEmailExist", cors(), (request, response) => {
  collection = database.collection("partners");
  console.log(request.body)
  return collection.findOne({email: request.body.email}).then(function(result){
    console.log(result)
      if (result === null) {
        return response.status(200).send(result);
      } else {
          var error = {};
          error.code = 'EmailExist';
          error.message = "This email address already exist."
          return response.status(201).send(error);
      }
  });
});

app.post("/login", cors(), (request, response) => {
  collection = database.collection("partners");
  console.log(request.body)
  return collection.findOne({email: request.body.email}).then(function(result){
      console.log(result)
      if (result === null) {
        return response.status(404).send(result);
      } else {
        if(!Bcrypt.compareSync(request.body.password, result.password)) {
          return response.status(400).send({ message: "The password is invalid" });
        } else {
          jwt.sign({ user: result}, 'secretkey', (err, token) => {
            result.token = token;
            return response.status(200).send(result);
          });
        } 
      }
  });
});

app.post("/campaigns", cors(), (request, response) => {
  collection = database.collection("campaigns");
  console.log(request.body)
  return collection.find({ partnerId: request.body.partnerId }).toArray().then(function(result){
    console.log(result)
      if (result === null) {
        return response.status(404).send(result);
      } else {
        jwt.sign({ user: result}, 'secretkey', (err, token) => {
          result.token = token;
          return response.status(200).send(result);
        });  
      }
  });
});

app.post("/posts", verifyToken, (request, response) => {
  jwt.verify(request.token, 'secretkey', (err, authData) => {
    console.log(err)
    if(err) {
      response.sendStatus(403);
    } else {
      return response.status(200).send(authData);
    }
  });
});

function verifyToken(req, res, next) {
  const bearerHeader = req.headers['authorization'];
  if (typeof bearerHeader !== 'undefined') {
    const bearer = bearerHeader.split(' ');
    const bearerToken = bearer[1];
    req.token = bearerToken;
    next();
  } else {
    res.sendStatus(403);
  }
}

app.post("/cloneCampaign", cors(), (request, response) => {
  collection = database.collection("campaigns");
  var ObjectId = require('mongodb').ObjectId; 
  var docId = new ObjectId(request.body.campaignId);
  return collection.findOne({_id: docId}).then( async function(result){
    console.log(result)
      if (result === null) {
        return response.status(404).send(result);
      } else {
        result._id = new ObjectId(); 
        let copiedDocument = await collection.insert(result)
        return collection.find({ partnerId: request.body.partnerId }).toArray().then(function(campaigns){
            if (result === null) {
              return response.status(404).send(campaigns);
            } else {
              return response.status(200).send(campaigns);  
            }
        });
        
      }
  });
}); 

app.post("/campaignResult", async (request, response) => {
    
  var ObjectId = require('mongodb').ObjectId; 
  var docId = new ObjectId(request.body.id);
      const votes = await collection.aggregate([
        {
          $match: {
           // options: { $not: { $size: 0}}
            _id: docId
          }
        },
        { $unwind: "$options" },
        {
            $group: {
                _id: {$toLower: '$options.choosenOption'},
                count: { $sum: 1 }
            }
        }
      ])
      .toArray();

      let totalVotes = 0;
      votes.map((vote, index) => {
        totalVotes += vote.count;
      })
      
      const votesResult = { votes: votes, totalVotes: totalVotes  }
      
      return collection.findOne({_id: docId}).then(function(document){
          if (document !== null) {
              votesResult.title = document.name;
              response.send(votesResult);
          } else {
              var error = {};
              error.message = "This campaign does not exist now."
              return response.status(500).send(error);
          }
      });
});



/* app.get("/files", (req, res) => {
	console.log(req.query)
  res.sendFile(path.join(__dirname, "./files/preview_logo.jpg"));
}); */