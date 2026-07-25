import boto3

# Initialize Bedrock client
bedrock = boto3.client(
    service_name="bedrock-runtime",
    region_name="us-east-1"
)

# Specify Model ID
model_id = "us.anthropic.claude-3-5-sonnet-20241022-v2:0"

# Set up message
messages = [
    {
        "role": "user",
        "content": [{"text": "Explain quantum computing in two simple sentences."}]
    }
]

# Send request
response = bedrock.converse(
    modelId=model_id,
    messages=messages,
    inferenceConfig={"temperature": 0.5, "maxTokens": 300}
)

# Print response
output_text = response['output']['message']['content'][0]['text']
print(output_text)