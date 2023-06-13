const request = require('supertest');
const expect = require('chai').expect;
const { createConnection, Exclusion } = require('typeorm');
const { startDockerCompose, stopDockerCompose } = require('./dockerComposeManager');
const { describe, before, after, beforeEach } = require('mocha');
const datetime = require('node-datetime');
const apiGatewayHost = 'http://localhost:3000';

const authedRequest = (request) => {
  return request.set('dev-email', 'test-athlete@mail.com');
}

async function truncateTables() {
  let connection = await createConnection({
    type: 'postgres',
    host: 'localhost',
    port: 5434,
    username: 'postgres',
    password: '12345678',
    database: 'postgres',
    schema: 'training-service',
    synchronize: false,
  });

  const tables = ['TrainingPlan'];

  for (const table of tables) {
    await connection.query(`TRUNCATE TABLE "training-service"."${table}" CASCADE`);
  }

  await connection.close();

  connection = await createConnection({
    type: 'postgres',
    host: 'localhost',
    port: 5434,
    username: 'postgres',
    password: '12345678',
    database: 'postgres',
    schema: 'training-service',
    synchronize: false,
  });

  await connection.query(`TRUNCATE TABLE "user-service"."User" CASCADE`);

  await connection.close();
}

const isServiceHealthy = async (servicePath) => {
  try {
    console.log(`waiting for service ${servicePath} to be healthy`)
    const response = await request(apiGatewayHost)
      .get(servicePath)
      .set('dev', 'true');
    console.log(`service ${servicePath} response: ${response.statusCode}`)
    return response.statusCode === 200;
  } catch (error) {
    return false;
  }
};

const waitUntilServicesAreHealthy = async () => {
  const serviceHealthPaths = [
    '/user-service/health',
    '/training-service/health',
    '/health',
  ];

  let allServicesHealthy = false;

  while (!allServicesHealthy) {
    console.log('Checking services health...');
    const healthChecks = await Promise.all(
      serviceHealthPaths.map((path) => isServiceHealthy(path))
    );
    allServicesHealthy = healthChecks.every((check) => check);

    if (!allServicesHealthy) {
      console.log('Waiting for all services to be healthy...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};

describe('Integration Tests ', () => {

  let testUser;
  let testUser2;
  let testTrainer;


  before(async () => {
    await startDockerCompose();
    await waitUntilServicesAreHealthy();
  });

  after(() => {
    return stopDockerCompose();
  });

  beforeEach(async () => {
    const response = await request(apiGatewayHost)
      .post('/user-service/api/users')
      .set('dev', 'true')
      .send({
        name: 'test athlete',
        email: 'test-athlete@mail.com',
      })

    testUser = response.body;

    const response2 = await request(apiGatewayHost)
      .post('/user-service/api/users')
      .set('dev', 'true')
      .send({
        name: 'test athlete 2',
        email: 'test-athlete-2@mail.com',
      })

    testUser2 = response2.body;

    const response3 = await request(apiGatewayHost)
      .post('/user-service/api/users')
      .set('dev', 'true')
      .send({
        name: 'test trainer',
        email: 'test-trainer@mail.com',
      })

    testTrainer = response3.body;
  })

  afterEach(async () => {
    await truncateTables();
  });

  it('GET health training service', async () => {
    const response = await authedRequest(
      request(apiGatewayHost)
        .get('/training-service/health'))

    expect(response.statusCode).to.be.equal(200);
  });

  it('complete POST training plan', async () => {
    const response = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan',
          type: 'Running',
          description: 'Test description',
          difficulty: 1,
          state: 'active',
          trainerId: testTrainer.id,
          location: "Test loc",
          latitude: "95",
          longitude: "55",
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00"
        })
    );
    console.log(response.body);
    expect(response.statusCode).to.be.equal(200);
    expect(response.body).to.have.property('title', 'Test plan');
    expect(response.body).to.have.property('type', 'Running');
    const trainings = await authedRequest(
      request(apiGatewayHost)
        .get('/training-service/api/trainings')
    );
    expect(trainings.body).to.have.lengthOf(1);
    expect(trainings.body[0]).to.have.property('title', 'Test plan');
    expect(trainings.body[0]).to.have.property('type', 'Running');
  });
  it('GET training plan', async () => {
    const response = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan',
          type: 'Running',
          description: 'Test description',
          difficulty: 1,
          state: 'active',
          trainerId: testTrainer.id,
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00",
          location: "Av test",
          latitude: "95",
          longitude: "55"
        })
    );
    const trainingId = response.body.id;
    console.log("training id", trainingId);
    const training = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/${trainingId}`)
    );
    expect(training.statusCode).to.be.equal(200);
    expect(training.body).to.have.property('title', 'Test plan');
    expect(training.body).to.have.property('type', 'Running');

  });

  it('GET training plan not found', async () => {
    const training = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/1`)
    );
    expect(training.statusCode).to.be.equal(404);
    expect(training.body).to.have.property('message', 'Training plan not found');
  });


  it('GET training plans', async () => {
    const response = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan',
          type: 'Running',
          description: 'Test description',
          difficulty: 1,
          state: 'active',
          trainerId: testTrainer.id,
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00",
          location: "Av test",
          latitude: "95",
          longitude: "55"
        })
    );

    const response2 = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan 2',
          type: 'Swimming',
          description: 'Test description',
          difficulty: 2,
          state: 'active',
          trainerId: testTrainer.id,
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00",
          location: "Av test",
          latitude: "95",
          longitude: "55"
        })
    );

    const trainings = await authedRequest(
      request(apiGatewayHost)
        .get('/training-service/api/trainings')
    );
    expect(trainings.statusCode).to.be.equal(200);
    expect(trainings.body).to.have.lengthOf(2);
    expect(trainings.body[0]).to.have.property('title', 'Test plan');
    expect(trainings.body[0]).to.have.property('type', 'Running');

    expect(trainings.body[1]).to.have.property('title', 'Test plan 2');
    expect(trainings.body[1]).to.have.property('type', 'Swimming');
  });

  it('POST user favorite trainings', async () => {
    const response = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan',
          type: 'Running',
          description: 'Test description',
          difficulty: 1,
          state: 'active',
          trainerId: testTrainer.id,
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00",
          location: "Av test",
          latitude: "95",
          longitude: "55"
        })
    );
    const trainingId = response.body.id;

    const favorite = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${trainingId}/favorite/${testUser.id}`)
    );

    expect(favorite.statusCode).to.be.equal(200);
    expect(favorite.body).to.have.property('userId', testUser.id);
    expect(favorite.body).to.have.property('trainingPlanId', trainingId);
  });


  it('GET user favorite trainings', async () => {
    const training1 = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan',
          type: 'Running',
          description: 'Test description',
          difficulty: 1,
          state: 'active',
          trainerId: testTrainer.id,
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00",
          location: "Av test",
          latitude: "95",
          longitude: "55"
        })
    );

    const training2 = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan 2',
          type: 'Swimming',
          description: 'Test description 2',
          difficulty: 4,
          state: 'active',
          trainerId: testTrainer.id,
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00",
          location: "Av test",
          latitude: "95",
          longitude: "55"
        })
    );

    const trainingId1 = training1.body.id;
    const trainingId2 = training2.body.id;

    let res = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${trainingId1}/favorite/${testUser.id}`)
    );
    expect(res.statusCode).to.be.equal(200);
    expect(res.body).to.have.property('userId', testUser.id);
    expect(res.body).to.have.property('trainingPlanId', trainingId1);

    res = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${trainingId2}/favorite/${testUser.id}`)
    );

    expect(res.statusCode).to.be.equal(200);
    expect(res.body).to.have.property('userId', testUser.id);
    expect(res.body).to.have.property('trainingPlanId', trainingId2);

    const favorites = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/favorites/${testUser.id}`)
    );
    expect(favorites.statusCode).to.be.equal(200);
    expect(favorites.body).to.have.lengthOf(2);
    expect(favorites.body[0]).to.have.property('title', 'Test plan');
    expect(favorites.body[0]).to.have.property('type', 'Running');
    expect(favorites.body[1]).to.have.property('title', 'Test plan 2');
    expect(favorites.body[1]).to.have.property('type', 'Swimming');
  });

  it("POST training review", async () => {

    const response = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan',
          type: 'Running',
          description: 'Test description',
          difficulty: 1,
          state: 'active',
          trainerId: testTrainer.id,
          location: "Test loc",
          latitude: "95",
          longitude: "55",
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00"
        })
    );

    const trainingId = response.body.id;

    const review = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${trainingId}/review/${testUser.id}`)
        .send({
          score: 5,
          comment: 'Test comment'
        })
    );

    expect(review.statusCode).to.be.equal(200);
    expect(review.body).to.have.property('userId', testUser.id);
    expect(review.body).to.have.property('trainingPlanId', trainingId);
    expect(review.body).to.have.property('score', 5);
    expect(review.body).to.have.property('comment', 'Test comment');
  });

  it("GET training reviews", async () => {

    const response = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan',
          type: 'Running',
          description: 'Test description',
          difficulty: 1,
          state: 'active',
          trainerId: testTrainer.id,
          location: "Test loc",
          latitude: "95",
          longitude: "55",
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00"
        })
    );

    const trainingId = response.body.id;

    const review = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${trainingId}/review/${testUser.id}`)
        .send({
          score: 5,
          comment: 'Test comment'
        })
    );



    const review2 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${trainingId}/review/${testUser2.id}`)
        .send({
          score: 2,
          comment: 'Test comment'
        })
    );

    const reviews = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/${trainingId}/reviews`)
    );

    expect(reviews.statusCode).to.be.equal(200);
    expect(reviews.body).to.have.lengthOf(2);
    expect(reviews.body[0]).to.have.property('userId', testUser.id);
    expect(reviews.body[0]).to.have.property('trainingPlanId', trainingId);
    expect(reviews.body[0]).to.have.property('score', 5);
    expect(reviews.body[0]).to.have.property('comment', 'Test comment');
    expect(reviews.body[1]).to.have.property('userId', testUser2.id);
    expect(reviews.body[1]).to.have.property('trainingPlanId', trainingId);
    expect(reviews.body[1]).to.have.property('score', 2);
    expect(reviews.body[1]).to.have.property('comment', 'Test comment');
  });

  it("POST invalid training review", async () => {
    const response = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan',
          type: 'Running',
          description: 'Test description',
          difficulty: 1,
          state: 'active',
          trainerId: testTrainer.id,
          location: "Test loc",
          latitude: "95",
          longitude: "55",
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00"
        })
    );

    const trainingId = response.body.id;

    // not puting valid training 
    const review = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/40000/review/${testUser.id}`)
        .send({
          score: 5,
          comment: 'Test comment'
        })
    );

    expect(review.statusCode).to.be.equal(404);
    expect(review.body).to.have.property('message', 'Training plan not found');


    // not puting valid user
    const review2 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${trainingId}/review/40000`)
        .send({
          score: 5,
          comment: 'Test comment'
        })
    );

    expect(review2.statusCode).to.be.equal(404);
    expect(review2.body).to.have.property('message', 'User not found');


    // not puting valid score
    const review3 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${trainingId}/review/${testUser.id}`)
        .send({
          score: 6,
          comment: 'Test comment'
        })
    );

    expect(review3.statusCode).to.be.equal(400);
    expect(review3.body).to.have.property('message', 'Score must be between 1 and 5');

    // missing score
    const review4 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${trainingId}/review/${testUser.id}`)
        .send({
          comment: 'Test comment'
        })
    );

    expect(review4.statusCode).to.be.equal(400);
    expect(review4.body).to.have.property('message', 'Missing required fields (user_id, training_plan_id or score))');

    // trainer cannot review his own training
    const review5 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${trainingId}/review/${testTrainer.id}`)
        .send({
          score: 5,
          comment: 'Test comment'
        })
    );

    expect(review5.statusCode).to.be.equal(409);
    expect(review5.body).to.have.property('message', "Trainer can't review his own training plan");
  });

  it("POST user training", async () => {

    const training = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan',
          type: 'Running',
          description: 'Test description',
          difficulty: 1,
          state: 'active',
          trainerId: testTrainer.id,
          location: "Test loc",
          latitude: "95",
          longitude: "55",
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00"
        })
    );

    const response = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": 15,
            "calories": 15,
            "duration": "01:00:00",
            "date": datetime.create().now(),
            "steps": 15
          }
        )
    );

    console.log("response body");
    console.log(response.body);
    console.log("response body fin");
    expect(response.statusCode).to.be.equal(200);
    expect(response.body).to.have.property('userId', testUser.id);
    expect(response.body).to.have.property('distance', 15);

  });

  it("POST invalid user training", async () => {
    const training = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan',
          type: 'Running',
          description: 'Test description',
          difficulty: 1,
          state: 'active',
          trainerId: testTrainer.id,
          location: "Test loc",
          latitude: "95",
          longitude: "55",
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00"
        })
    );



    const response = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": -8,
            "calories": -8,
            "duration": "10:00:00",
            "date": -8,
            "steps": -8
          }
        )
    );

    expect(response.statusCode).to.be.equal(400);
    expect(response.body).to.have.property('message', 'Distance, duration, steps and calories must be positive');

    const response2 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training.body.id}/user_training/4000`)
        .send(
          {
            "distance": 1,
            "calories": 1,
            "duration": "10:00:00",
            "date": datetime.create().now(),
            "steps": 1
          }
        )
    );

    expect(response2.statusCode).to.be.equal(404);
    expect(response2.body).to.have.property('message', 'User not found');

    const response3 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training.body.id}/user_training/${testUser.id}`)
        .send(
          {
          }
        )
    );

    expect(response3.statusCode).to.be.equal(400);
    expect(response3.body).to.have.property('message', 'Missing required fields (distance, duration, steps, calories or date)');


    const response4 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/12312313/user_training/${testUser.id}`)
        .send(
          {
            "distance": 1,
            "calories": 1,
            "duration": "10:00:00",
            "date": datetime.create().now(),
            "steps": 1
          }
        )
    );

    expect(response4.statusCode).to.be.equal(404);
    expect(response4.body).to.have.property('message', 'Training plan not found');

    const response5 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": 1,
            "calories": 1,
            "duration": "10:00:00",
            "date": "2024-05-27T07:00:00Z",
            "steps": 1
          }
        )
    );

    expect(response5.statusCode).to.be.equal(400);
    expect(response5.body).to.have.property('message', "Date can't be in the future");

    const response6 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": 1,
            "calories": 1,
            "duration": 1,
            "date": "2022-05-27T07:00:00Z",
            "steps": 1
          }
        )
    );

    expect(response6.statusCode).to.be.equal(400);
    expect(response6.body).to.have.property('message', "Duration must be in format HH:MM:SS");


  });

  it("GET user trainings of a specific training plan", async () => {

    const training = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan',
          type: 'Running',
          description: 'Test description',
          difficulty: 1,
          state: 'active',
          trainerId: testTrainer.id,
          location: "Test loc",
          latitude: "95",
          longitude: "55",
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00"
        })
    );

    const training_session1 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": 20,
            "calories": 15,
            "duration": "10:00:00",
            "date": 15,
            "steps": 15
          }
        )
    );

    const training_session2 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": 10,
            "calories": 15,
            "duration": "10:00:00",
            "date": 15,
            "steps": 15
          }
        )
    );

    const response = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/${training.body.id}/user_training/${testUser.id}`)
    );

    expect(response.statusCode).to.be.equal(200);
    expect(response.body).to.be.an('array');
    expect(response.body).to.have.lengthOf(2);
    expect(response.body[0]).to.have.property('distance', 20);
    expect(response.body[1]).to.have.property('distance', 10);
  });


  it("GET all user trainings", async () => {

    const training = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan',
          type: 'Running',
          description: 'Test description',
          difficulty: 1,
          state: 'active',
          trainerId: testTrainer.id,
          location: "Test loc",
          latitude: "95",
          longitude: "55",
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00"
        })
    );

    const training2 = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan swimming',
          type: 'Swimming',
          description: 'Test description swim',
          difficulty: 3,
          state: 'active',
          trainerId: testTrainer.id,
          location: "Test loc",
          latitude: "95",
          longitude: "55",
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00"
        })
    );

    const training_session1 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": 20,
            "calories": 15,
            "duration": "10:00:00",
            "date": 15,
            "steps": 15
          }
        )
    );

    const training_session2 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training2.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": 100,
            "calories": 12,
            "duration": "11:00:00",
            "date": 15,
            "steps": 15
          }
        )
    );

    const response = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/user_training/${testUser.id}`)
    );

    expect(response.statusCode).to.be.equal(200);
    expect(response.body).to.be.an('array');
    expect(response.body).to.have.lengthOf(2);
    expect(response.body[0]).to.have.property('distance', 20);
    expect(response.body[1]).to.have.property('distance', 100);
  });


  it("GET user trainings between dates", async () => {

    const training = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan',
          type: 'Running',
          description: 'Test description',
          difficulty: 3,
          state: 'active',
          trainerId: testTrainer.id,
          location: "Test loc",
          latitude: "95",
          longitude: "55",
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00"
        })
    );
    expect(training.statusCode).to.be.equal(200);

    const training_session1 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": 20,
            "calories": 15,
            "duration": "10:00:00",
            "date": "2022-05-27T07:00:00Z",
            "steps": 15
          }
        )
    );
    expect(training_session1.statusCode).to.be.equal(200);

    const training_session2 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": 100,
            "calories": 12,
            "duration": "01:00:00",
            "date": "2022-05-27T08:00:00Z",
            "steps": 15
          }
        )
    );
    expect(training_session2.statusCode).to.be.equal(200);

    const response = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/user_training/${testUser.id}/between_dates`)
        .send({
          start: "2022-05-27T06:00:00Z",
          end: "2022-05-27T09:00:00Z"
        })
    );

    expect(response.statusCode).to.be.equal(200);
    expect(response.body).to.be.an('array');
    expect(response.body).to.have.lengthOf(2);
    expect(response.body[0]).to.have.property('distance', 20);
    expect(response.body[1]).to.have.property('distance', 100);

  }
  );

  it("GET user trainings between dates invalid", async () => {
    const response = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/user_training/4555/between_dates`)
        .send({
          start: "2022-05-27T06:00:00Z",
          end: "2022-05-27T09:00:00Z"
        })
    );

    expect(response.statusCode).to.be.equal(404);
    expect(response.body).to.have.property('message', 'User not found');

    const response2 = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/user_training/${testUser.id}/between_dates`)
        .send({
          start: "2024-05-27T06:00:00Z",
          end: "2022-05-27T09:00:00Z"
        })
    );

    expect(response2.statusCode).to.be.equal(400);
    expect(response2.body).to.have.property('message', "Start date must be before end date");

    const response3 = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/user_training/${testUser.id}/between_dates`)
        .send({
          end: "2022-05-27T09:00:00Z"
        })
    );

    expect(response3.statusCode).to.be.equal(401);
    expect(response3.body).to.have.property('message', "Missing required fields (start or end date)");
  });

  it("GET user trainingplans between interval", async () => {

    const training = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Running',
          type: 'Running',
          description: 'Test description',
          difficulty: 3,
          state: 'active',
          trainerId: testTrainer.id,
          location: "Test loc",
          latitude: "95",
          longitude: "55",
          days: "monday, wednesday",
          start: "10:00",
          end: "11:00"
        })
    );
    expect(training.statusCode).to.be.equal(200);

    const training2 = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Swimming',
          type: 'Swimming',
          description: 'Test description',
          difficulty: 3,
          state: 'active',
          trainerId: testTrainer.id,
          location: "Test loc",
          latitude: "95",
          longitude: "55",
          days: "monday, wednesday",
          start: "10:00",
          end: "11:00"
        })
    );
    expect(training2.statusCode).to.be.equal(200);

    const response = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/between_dates`)
        .send({
          days: "monday",
        })
    );

    expect(response.statusCode).to.be.equal(200);
    expect(response.body).to.be.an('array');
    expect(response.body).to.have.lengthOf(2);
    expect(response.body[0]).to.have.property('title', 'Running');
    expect(response.body[1]).to.have.property('title', 'Swimming');

    const response2 = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/between_hours`)
        .send({
          start: "09:00",
          end: "12:00"
        })
    );

    expect(response2.statusCode).to.be.equal(200);
    expect(response2.body).to.be.an('array');
    expect(response2.body).to.have.lengthOf(2);
    expect(response2.body[0]).to.have.property('title', 'Running');
    expect(response2.body[1]).to.have.property('title', 'Swimming');

    // Falta testear between dates and hours

  }
  );


  it ("GET user trainings between interval group by weeks", async () => {


    const training = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan',
          type: 'Running',
          description: 'Test description',
          difficulty: 1,
          state: 'active',
          trainerId: testTrainer.id,
          location: "Test loc",
          latitude: "95",
          longitude: "55",
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00"
        })
    );

    const training2 = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan swimming',
          type: 'Swimming',
          description: 'Test description swim',
          difficulty: 3,
          state: 'active',
          trainerId: testTrainer.id,
          location: "Test loc",
          latitude: "95",
          longitude: "55",
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00"
        })
    );

    const training_session1 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": 1,
            "calories": 1,
            "duration": "10:00:00",
            "date": "2021-05-27T07:00:00Z",
            "steps": 1
          }
        )
    );

    const training_session2 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training2.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": 2,
            "calories": 2,
            "duration": "11:00:00",
            "date": 2,
            "steps": 2,
            "date": "2022-05-27T07:00:00Z"
          }
        )
    );

    const training_session3 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": 3,
            "calories": 3,
            "duration": "11:00:00",
            "date": 3,
            "steps": 3,
            "date": "2023-05-27T07:00:00Z"
          }
        )
    );

    const training_session6 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": 3,
            "calories": 3,
            "duration": "11:00:00",
            "date": 3,
            "steps": 3,
            "date": "2023-05-27T08:00:00Z"
          }
        )
    );

    const training_session4 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": 4,
            "calories": 4,
            "duration": "10:00:00",
            "date": "2021-05-28T07:00:00Z",
            "steps": 4
          }
        )
    );

    const training_session5 = await authedRequest(
      request(apiGatewayHost)
        .post(`/training-service/api/trainings/${training2.body.id}/user_training/${testUser.id}`)
        .send(
          {
            "distance": 5,
            "calories": 5,
            "duration": "10:00:00",
            "date": "2021-07-28T07:00:00Z",
            "steps": 5
          }
        )
    );

    
    const response = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/user_training/${testUser.id}/between_dates/group_by/year`)
        .send({
          start: "2021-05-27T06:00:00Z",
          end: "2025-05-27T09:00:00Z"
        })
    );

    expect(response.statusCode).to.be.equal(200);
    expect(response.body).to.be.an('array');
    expect(response.body).to.have.lengthOf(3);
    expect(response.body[0]).to.have.property('year', 2021);
    expect(response.body[0]).to.have.property('distance', 10);
    expect(response.body[1]).to.have.property('year', 2022);
    expect(response.body[1]).to.have.property('distance', 2);
    expect(response.body[2]).to.have.property('year', 2023);
    expect(response.body[2]).to.have.property('distance', 6);


    const response2 = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/user_training/${testUser.id}/between_dates/group_by/month`)
        .send({
          start: "2021-05-27T06:00:00Z",
          end: "2025-05-27T09:00:00Z"
        })
    );

    expect(response2.statusCode).to.be.equal(200);
    expect(response2.body).to.be.an('array');
    expect(response2.body).to.have.lengthOf(4);
    expect(response2.body[0]).to.have.property('month', "5-2021");
    expect(response2.body[0]).to.have.property('distance', 5);
    expect(response2.body[1]).to.have.property('month', "5-2022");
    expect(response2.body[1]).to.have.property('distance', 2);
    expect(response2.body[2]).to.have.property('month', "5-2023");
    expect(response2.body[2]).to.have.property('distance', 6);
    expect(response2.body[3]).to.have.property('month', "7-2021");
    expect(response2.body[3]).to.have.property('distance', 5);



    const response3 = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/user_training/${testUser.id}/between_dates/group_by/week`)
        .send({
          start: "2021-05-27T06:00:00Z",
          end: "2025-05-27T09:00:00Z"
        })
    );

      expect(response3.statusCode).to.be.equal(200);
      expect(response3.body).to.be.an('array');
      expect(response3.body).to.have.lengthOf(4);
      expect(response3.body[0]).to.have.property('week', "21-2021");
      expect(response3.body[0]).to.have.property('distance', 5);
      expect(response3.body[1]).to.have.property('week', "21-2022");
      expect(response3.body[1]).to.have.property('distance', 2);
      expect(response3.body[2]).to.have.property('week', "21-2023");
      expect(response3.body[2]).to.have.property('distance', 6);
      expect(response3.body[3]).to.have.property('week', "30-2021");
      expect(response3.body[3]).to.have.property('distance', 5);



    const response4 = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/user_training/${testUser.id}/between_dates/group_by/day`)
        .send({
          start: "2021-05-27T06:00:00Z",
          end: "2025-05-27T09:00:00Z"
        })
    );

    expect(response4.statusCode).to.be.equal(200);
    expect(response4.body).to.be.an('array');
    expect(response4.body).to.have.lengthOf(5);
    expect(response4.body[0]).to.have.property('day', "27-5-2021");
    expect(response4.body[0]).to.have.property('distance', 1);
    expect(response4.body[1]).to.have.property('day', "27-5-2022");
    expect(response4.body[1]).to.have.property('distance', 2);
    expect(response4.body[2]).to.have.property('day', "27-5-2023");
    expect(response4.body[2]).to.have.property('distance', 6);
    expect(response4.body[3]).to.have.property('day', "28-5-2021");
    expect(response4.body[3]).to.have.property('distance', 4);
    expect(response4.body[4]).to.have.property('day', "28-7-2021");
    expect(response4.body[4]).to.have.property('distance', 5);


    const response5 = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/user_training/${testUser.id}/between_dates/group_by/day`)
        .send({
          start: "2025-05-27T06:00:00Z",
          end: "2030-05-27T09:00:00Z"
        })
    );

    expect(response5.statusCode).to.be.equal(200);
    expect(response5.body).to.be.an('array');
    expect(response5.body).to.have.lengthOf(0);



  });  


  it ("GET user trainings between interval group by weeks invalid", async () => {
  
    const training = await authedRequest(
      request(apiGatewayHost)
        .post('/training-service/api/trainings')
        .send({
          title: 'Test plan',
          type: 'Running',
          description: 'Test description',
          difficulty: 1,
          state: 'active',
          trainerId: testTrainer.id,
          location: "Test loc",
          latitude: "95",
          longitude: "55",
          days: "monday, tuesday",
          start: "10:00",
          end: "11:00"
        })
    );

    const response = await authedRequest(
      request(apiGatewayHost)
        .get(`/training-service/api/trainings/user_training/${testUser.id}/between_dates/group_by/invalid`)
        .send({
          start: "2021-05-27T06:00:00Z",
          end: "2025-05-27T09:00:00Z"
        })
    );

    expect(response.statusCode).to.be.equal(400);
    expect(response.body).to.have.property('message', "Invalid group by value");

  });


});