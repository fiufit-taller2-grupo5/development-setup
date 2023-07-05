const request = require('supertest');
const expect = require('chai').expect;
const { createConnection } = require('typeorm');
const { startDockerCompose, stopDockerCompose } = require('./dockerComposeManager');
const { describe, before, after, beforeEach } = require('mocha');

const apiGatewayHost = 'http://localhost:3000';

async function truncateTables() {
    const connection = await createConnection({
        type: 'postgres',
        host: 'localhost',
        port: 5434,
        username: 'postgres',
        password: '12345678',
        database: 'postgres',
        schema: 'user-service',
        synchronize: false,
    });

    const tables = ['User'];

    for (const table of tables) {
        await connection.query(`TRUNCATE TABLE "user-service"."${table}" CASCADE`);
    }

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

describe('Integration Tests ', function () {

    this.timeout(1000000);

    const userRequest = (request) => {
        return request.set('dev-email', 'test-user@mail.com');
    }

    const adminRequest = (request) => {
        return request.set('dev-email', 'test-admin@mail.com');
    }

    before(async () => {
        await startDockerCompose();
        await waitUntilServicesAreHealthy();
    });

    after(() => {
        return stopDockerCompose();
    });

    beforeEach(async () => {
        await request(apiGatewayHost)
            .post('/user-service/api/admins')
            .set('dev', 'true')
            .send({
                name: 'test admin',
                email: 'test-admin@mail.com',
                password: 'admin123'
            });

        await adminRequest(
            request(apiGatewayHost)
                .post('/user-service/api/users')
                .send({
                    name: 'test user',
                    email: 'test-user@mail.com',
                })
        )
    });

    afterEach(async () => {
        await truncateTables();
    });

    it('GET health user service', async () => {
        const response = await userRequest(
            request(apiGatewayHost)
                .get('/user-service/health'))

        expect(response.statusCode).to.be.equal(200);
    });

    it('POST user', async () => {
        const response = await userRequest(
            request(apiGatewayHost)
                .post('/user-service/api/users')
                .send({
                    name: 'test post',
                    email: 'test-post@email.com',
                }))


        const allUsersResponse = await userRequest(
            request(apiGatewayHost)
                .get('/user-service/api/users')
        )

        expect(allUsersResponse.body.some((u) => u.name === 'test post')).to.be.equal(true);
    });


    it('GET non-existent user', async () => {
        const response = await userRequest(
            request(apiGatewayHost)
                .get('/user-service/api/users/123')
        )

        expect(response.statusCode).to.be.equal(404);
    });

    it('GET all users', async () => {
        const response = await userRequest(
            request(apiGatewayHost)
                .get('/user-service/api/users')
        )

        expect(response.statusCode).to.be.equal(200);
        expect(response.body.length).to.be.equal(1);
    });

    it('POST user with missing fields', async () => {
        const response = await userRequest(
            request(apiGatewayHost)
                .post('/user-service/api/users')
                .send({
                    name: 'test'
                })
        );

        expect(response.statusCode).to.be.equal(400);
        expect(response.body.error).to.be.equal('Falta nombre o contraseña');
    });

    it('POST user with used email', async () => {
        await userRequest(
            request(apiGatewayHost)
                .post('/user-service/api/users')
                .send({
                    name: 'test',
                    email: 'test@mail'
                }));

        const postResponse = await userRequest(
            request(apiGatewayHost)
                .post('/user-service/api/users')
                .send({
                    name: 'test2',
                    email: 'test@mail'
                }));

        expect(postResponse.statusCode).to.be.equal(409);
        expect(postResponse.body.message).to.be.equal('email test@mail ya está en uso');
    });


    it('DELETE user', async () => {
        this.timeout(1000000);
        const postResponse = await userRequest(
            request(apiGatewayHost)
                .post('/user-service/api/users')
                .timeout(10000)
                .send({
                    name: 'test',
                    email: 'test@email.com',
                }));

        expect(postResponse.statusCode).to.be.equal(200);

        const users = await userRequest(
            request(apiGatewayHost)
                .get('/user-service/api/users'));


        const userId = users.body[0].id;

        await await userRequest(
            request(apiGatewayHost)
                .delete(`/user-service/api/users/${userId}`));

        const getResponse = await userRequest(
            request(apiGatewayHost)
                .get(`/user-service/api/users/${userId}`));

        expect(getResponse.statusCode).to.be.equal(404);

    });

    it('PUT user with invalid id', async () => {
        const putResponse = await userRequest(
            request(apiGatewayHost)
                .put(`/user-service/api/users/123/metadata`)
                .send({
                    name: 'test2',
                    email: 'test2@mail',
                    location: 'test',

                }));
        expect(putResponse.statusCode).to.be.equal(404);
        expect(putResponse.body.message).to.be.equal('user with id 123 not found');
    });

    it('PUT user with invalid metadata, things missing', async () => {
        const postResponse = await userRequest(
            request(apiGatewayHost)
                .post('/user-service/api/users')
                .send({
                    name: 'test',
                    email: 'test@mail'
                }));

        const response = await userRequest(
            request(apiGatewayHost)
                .get('/user-service/api/users'));

        const userId = response.body[0].id;
        const putResponse = await userRequest(
            request(apiGatewayHost)
                .put(`/user-service/api/users/${userId}/metadata`)
                .send({
                    name: 'test',
                    email: 'test@mail'
                }));
        expect(putResponse.statusCode).to.be.equal(400);
    });

    it('GET user with entire information', async () => {
        this.timeout(1000000);
        const users = await userRequest(
            request(apiGatewayHost)
                .get('/user-service/api/users'));


        const userId = users.body[0].id;

        const metadataResponse = await userRequest(
            request(apiGatewayHost)
                .put(`/user-service/api/users/${userId}/metadata`)
                .send({
                    location: 'test',
                    interests: 'Cardio',
                    birthDate: '2000-01-01T00:00:00.00Z',
                    height: 1,
                    weight: 2
                }));

        expect(metadataResponse.statusCode).to.be.equal(200);
        expect(metadataResponse.body.status).to.be.equal(`Metadata added for user with id ${userId}`);
        const getResponse = await userRequest(
            request(apiGatewayHost)
                .get(`/user-service/api/users/${userId}`));

        expect(getResponse.statusCode).to.be.equal(200);
        expect(getResponse.body.name).to.be.equal('test user');
        expect(getResponse.body.email).to.be.equal('test-user@mail.com');
    });


    it('create new Admin', async () => {
        await userRequest(
            request(apiGatewayHost)
                .post('/user-service/api/admins')
                .send({
                    name: 'test',
                    email: 'test@mail',
                    password: 'test'
                }).set('test', 'true'));

        const response = await userRequest(
            request(apiGatewayHost)
                .get('/user-service/api/admins')
        )

        expect(response.statusCode).to.be.equal(200);
        expect(response.body.some((a) => a.name === 'test')).to.be.equal(true);
    });

    it('GET non-existent admin', async () => {
        const response = await userRequest(
            request(apiGatewayHost)
                .get('/user-service/api/admins/123')
        )
        expect(response.statusCode).to.be.equal(404);
    });

    it('try to create admin with missing fields', async () => {
        const response = await userRequest(
            request(apiGatewayHost)
                .post('/user-service/api/admins')
                .send({
                    name: 'test'
                }).set('test', 'true'));


        expect(response.statusCode).to.be.equal(400);
        expect(response.body.error).to.be.equal('Falta nombre o contraseña');
    });

    it('try to create admin with used email', async () => {
        await userRequest(
            request(apiGatewayHost)
                .post('/user-service/api/admins')
                .send({
                    name: 'test',
                    email: 'test@mail'
                }).set('test', 'true'));

        const postResponse = await userRequest(
            request(apiGatewayHost)
                .post('/user-service/api/admins')
                .send({
                    name: 'test',
                    email: 'test@mail'
                }).set('test', 'true'));

        expect(postResponse.statusCode).to.be.equal(500);
        expect(postResponse.body.message).to.be.equal('Email ya está en uso');
    });


    it('DELETE admin', async () => {
        const postResponse = await userRequest(
            request(apiGatewayHost)
                .post('/user-service/api/admins')
                .send({
                    name: 'test',
                    email: 'test@email.com',
                }).set('test', 'true'));

        expect(postResponse.statusCode).to.be.equal(200);

        const users = await userRequest(
            request(apiGatewayHost)
                .get('/user-service/api/admins'));


        const userId = users.body[0].id;

        await await userRequest(
            request(apiGatewayHost)
                .delete(`/user-service/api/admins/${userId}`));

        const getResponse = await userRequest(
            request(apiGatewayHost)
                .get(`/user-service/api/admins/${userId}`));

        expect(getResponse.statusCode).to.be.equal(404);
    });

    // change metadata in user 
    it('change user metadata', async () => {
        
        this.timeout(1000000);
        const users = await userRequest(
            request(apiGatewayHost)
                .get('/user-service/api/users'));


        const userId = users.body[0].id;

        const putResponse = await userRequest(
            request(apiGatewayHost)
                .put(`/user-service/api/users/${userId}/metadata`)
                .send({
                    name: 'test2',
                    email: 'test2@mail',
                    location: 'test',
                    interests: 'Cardio',
                    birthDate: '2000-01-01T00:00:00.000Z',
                    height: 1,
                    weight: 2,

                }));

        const getResponse = await userRequest(
            request(apiGatewayHost)
                .get(`/user-service/api/users/${userId}/metadata`));

        expect(getResponse.statusCode).to.be.equal(200);
        expect(getResponse.body.location).to.be.equal('test');
    });

    it('blocked user cannot do anything', async () => {
        this.timeout(100000000000);
        const { body } = await userRequest(
            request(apiGatewayHost)
                .post('/user-service/api/users')
                .send({
                    name: 'test2',
                    email: 'test2@mail'
                })
                .timeout(1000000000));

        const { body: blockedResponse } = await adminRequest(
            request(apiGatewayHost)
                .post('/user-service/api/users/block')
                .send({
                    userId: body.id
                }));

        // Request all endpoints in parallel using Promise.all()
        const endpoints = [
            '/user-service/api/users',
            `/user-service/api/users/${body.id}`,
            '/user-service/api/users/interests',
            '/training-service/api/trainings',
            '/training-service/api/trainings/1',
            '/training-service/api/trainings/1/favorite/1',
        ];

        const requests = endpoints.map(endpoint =>
            request(apiGatewayHost)
                .get(endpoint)
                .set('dev-email', body.email)
        );

        const responses = await Promise.all(requests);

        responses.forEach(response => {
            expect(response.statusCode).to.be.equal(403);
            expect(response.body.message).to.be.equal('you do not have access to the system');
        });
    });


    it('change user name', async () => {
        this.timeout(1000000);
        const users = await userRequest(
            request(apiGatewayHost)
                .get('/user-service/api/users'));

        const userId = users.body[0].id;

        const putResponse = await userRequest(
            request(apiGatewayHost)
                .put(`/user-service/api/users/${userId}/name`)
                .send({
                    name: 'test new'
                }));

        expect(putResponse.statusCode).to.be.equal(200);
        expect(putResponse.body.status).to.be.equal("Name changed");

        const getResponse = await userRequest(
            request(apiGatewayHost)
                .get(`/user-service/api/users/${userId}`));


        expect(getResponse.statusCode).to.be.equal(200);
        expect(getResponse.body.name).to.be.equal('test new');

        const putInvalidResponse = await userRequest(
            request(apiGatewayHost)
                .put(`/user-service/api/users/${userId}/name`)
                .send({
                    name: ""
                }));

        const putInvalidResponse2 = await userRequest(
            request(apiGatewayHost)
                .put(`/user-service/api/users/${userId}/name`)
                .send({
                    name: 2
                }));

        const putInvalidResponse3 = await userRequest(
            request(apiGatewayHost)
                .put(`/user-service/api/users/150/name`)
                .send({
                    name: "jj"
                }));

        expect(putInvalidResponse.statusCode).to.be.equal(400);
        expect(putInvalidResponse.body.error).to.be.equal("Debe proporcionar nombre");

        expect(putInvalidResponse2.statusCode).to.be.equal(400);
        expect(putInvalidResponse2.body.error).to.be.equal("Name must be a string");


        expect(putInvalidResponse3.statusCode).to.be.equal(404);
        expect(putInvalidResponse3.body.message).to.be.equal("user with id 150 not found");


        });


  it('should create a new notification', async () => {
    this.timeout(10000000000);
    const users = await userRequest(
            request(apiGatewayHost)
            .get('/user-service/api/users'));


    const userId = users.body[0].id;
    
    const response = await request(apiGatewayHost)
      .post(`/user-service/api/users/${userId}/notifications`)
      .set('dev', 'true')
      .send({
        title: 'test notification',
        body: 'test notification body',
      });
    
    console.log("response: ", response.body);

    expect(response.body.message).to.be.equal(`user with id ${userId} has no push token`);
    
    const getResponse = await userRequest(
            request(apiGatewayHost)
            .post(`/user-service/api/users/${userId}/set-push-token`)
            .set('dev', 'true')
            .send({
                token: 'test token'
            }));
    
    console.log("getResponse: ", getResponse.body);

    const response2 = await request(apiGatewayHost)
        .post(`/user-service/api/users/${userId}/notifications`)
        .set('dev', 'true')
        .send({
            title: 'test notification',
            body: 'test notification body',
        });

    console.log("response2: ", response2.body);

    expect(response2.body.status).to.be.equal(`Notification saved and sended`);
    expect(response2.statusCode).to.be.equal(200);

  });

    it('should get all notifications', async () => {
        this.timeout(10000000000);

        const newUsers = await userRequest(
            request(apiGatewayHost)
            .post('/user-service/api/users')
            .send({
                name: 'test2',
                email: 'test2@mail'
            }));


        const users = await userRequest(
                request(apiGatewayHost)
                .get('/user-service/api/users'));
    
    
        const userId = users.body[0].id;
        const userId2 = users.body[1].id;
        
        
        const getResponse = await userRequest(
                request(apiGatewayHost)
                .post(`/user-service/api/users/${userId}/set-push-token`)
                .set('dev', 'true')
                .send({
                    token: 'test token'
                }));
        
        console.log("getResponse: ", getResponse.body);
    
        const response2 = await request(apiGatewayHost)
            .post(`/user-service/api/users/${userId}/notifications`)
            .set('dev', 'true')
            .send({
                title: 'test notification',
                body: 'test notification body',
                fromUserId: userId2
            });
    
        console.log("response2: ", response2.body);
    
        expect(response2.body.status).to.be.equal(`Notification saved and sended`);
        expect(response2.statusCode).to.be.equal(200);


        const response3 = await userRequest(
            request(apiGatewayHost)
            .get(`/user-service/api/users/${userId}/notifications`)
            .set('dev', 'true')
        );

        expect(response3.body[0].title).to.be.equal('test notification');
        expect(response3.body[0].body).to.be.equal('test notification body');
        expect(response3.body[0].userId).to.be.equal(userId);
        expect(response3.body[0].date).to.not.be.null;
        expect(response3.body[0].sender.id).to.be.equal(userId2);
        expect(response3.body[0].sender.email).to.be.equal('test2@mail');
        expect(response3.body[0].sender.name).to.be.equal('test2');
    });


});
