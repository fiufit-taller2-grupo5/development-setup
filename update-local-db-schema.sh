#!/bin/bash

compose_file="docker-compose.yml"
stop_flag="false"
service_name=""
schema_name=""

while [[ $# -gt 0 ]]
do
key="$1"

case $key in
    -f|--file)
    compose_file="$2"
    shift
    shift
    ;;
    --stop)
    stop_flag="true"
    shift
    ;;
    -s|--service)
    service_name="$2"
    shift
    shift
    ;;
    *)
    echo "Unknown option: $1"
    exit 1
    ;;
esac
done

if [ -z "$service_name" ]; then
  echo "Please provide --service option"
  exit 1
fi

# Step 1: Execute docker compose up for running the db
docker compose -f "$compose_file" up -d postgres-service

# Step 2: Wait for the database to be ready
container_name="postgres-service"
db_host="localhost"
db_local_port="5432"
db_host_mapped_port="5434"
db_user="postgres"
db_password="12345678"
db_name="postgres"

echo "Waiting for database to be ready..."
while :
do
  output=$(docker exec -e PGPASSWORD="$db_password" "$container_name" psql -h "$db_host" -p "$db_local_port" -U "$db_user" -w -d "$db_name" -c "SELECT 1" 2>&1)
  if [ $? -eq 0 ]; then
    break
  else
    echo "Failed to connect to database. Error output:"
    echo "$output"
    sleep 1
  fi
done
echo "Database is ready."

# Step 2: Create/overwrite .env file
PRISMA_ENV_PATH="../${service_name}/prisma/.env"
mkdir -p "$(dirname "$PRISMA_ENV_PATH")"
echo "DATABASE_URL=postgresql://${db_user}:${db_password}@${db_host}:${db_host_mapped_port}/${db_name}?schema=${service_name}" > "$PRISMA_ENV_PATH"

# Step 3: Execute yarn and npx prisma db push
cd "../${service_name}"
npm i prisma && npx prisma db push

# Step 3.5: reset ENV file:
PRISMA_ENV_PATH="./prisma/.env"
mkdir -p "$(dirname "$PRISMA_ENV_PATH")"
echo "DATABASE_URL=postgresql://${db_user}:${db_password}@${container_name}:${db_local_port}/${db_name}?schema=${service_name}" > "$PRISMA_ENV_PATH"


# Step 4: Stop the database if stop flag is set
cd "../development-setup"
if [ "$stop_flag" == "true" ]; then
  docker compose -f "$compose_file" stop postgres-service
  echo "Database stopped. Update successful."
fi
